"""Prepare a bounded, browser-playable copy; never modify the source recording."""
from pathlib import Path
import re
import subprocess
from threading import BoundedSemaphore
from fastapi import HTTPException
import imageio_ffmpeg

MIB=1024*1024
MAX_VIDEO_OUTPUT=45*MIB
ENCODERS=BoundedSemaphore(2)

def copy_limited(source,destination:Path,limit:int) -> int:
    source.seek(0);size=0
    with destination.open('wb') as output:
        while chunk:=source.read(1024*1024):
            size+=len(chunk)
            if size>limit:raise HTTPException(status_code=413,detail='Attachment exceeds its file size limit.')
            output.write(chunk)
    if not size:raise HTTPException(status_code=400,detail='Empty files cannot be submitted.')
    return size

def prepare_video(source:Path,destination:Path,content_type:str) -> float:
    binary=imageio_ffmpeg.get_ffmpeg_exe()
    demuxer='matroska' if content_type=='video/webm' else 'mov'
    try:
        probe=subprocess.run([binary,'-hide_banner','-protocol_whitelist','file,pipe','-f',demuxer,'-i',str(source)],capture_output=True,text=True,timeout=30)
        match=re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)',probe.stderr)
        if not match or 'Video:' not in probe.stderr:raise HTTPException(status_code=400,detail='This video could not be read. Choose another MP4, MOV, or WebM file.')
        duration=int(match[1])*3600+int(match[2])*60+float(match[3])
        if not 0<duration<=60.5:raise HTTPException(status_code=400,detail='Videos must be 60 seconds or shorter. Trim this video before attaching it.')
        filters="scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30"
        if 'smpte2084' in probe.stderr or 'arib-std-b67' in probe.stderr:
            filters='zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,'+filters
        with ENCODERS:
            result=subprocess.run([binary,'-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-f',demuxer,'-i',str(source),
                '-t','60','-map','0:v:0','-map','0:a:0?','-sn','-dn','-map_metadata','-1','-vf',filters,
                '-c:v','libx264','-preset','veryfast','-b:v','5M','-maxrate','5M','-bufsize','10M','-pix_fmt','yuv420p','-threads','2',
                '-c:a','aac','-b:a','128k','-movflags','+faststart',str(destination)],capture_output=True,timeout=300)
        if result.returncode or not destination.exists() or not 0<destination.stat().st_size<=MAX_VIDEO_OUTPUT:
            raise HTTPException(status_code=400,detail='Could not prepare this video for upload. Please try another clip.')
        return min(duration,60)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=400,detail='Video processing took too long. Try a shorter clip.') from exc
