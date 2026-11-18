import subprocess
from pathlib import Path
import pytest
import imageio_ffmpeg
from fastapi import HTTPException
from app.video import prepare_video,copy_limited,MAX_VIDEO_OUTPUT
from io import BytesIO

def make_video(path:Path,seconds:int):
    result=subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=64x64:r=1','-t',str(seconds),'-c:v','libx264','-pix_fmt','yuv420p',str(path)],capture_output=True,timeout=30)
    assert result.returncode==0

def test_a_short_phone_video_becomes_a_playable_bounded_mp4(tmp_path):
    source=tmp_path/'source.mp4';output=tmp_path/'upload.mp4';make_video(source,2)
    original=source.read_bytes();duration=prepare_video(source,output,'video/mp4')
    assert duration==2;assert 0<output.stat().st_size<=MAX_VIDEO_OUTPUT;assert source.read_bytes()==original

def test_videos_longer_than_sixty_seconds_are_rejected(tmp_path):
    source=tmp_path/'long.mp4';make_video(source,62)
    with pytest.raises(HTTPException,match='60 seconds'):
        prepare_video(source,tmp_path/'upload.mp4','video/mp4')

def test_sixty_second_video_is_accepted(tmp_path):
    source=tmp_path/'minute.mp4';output=tmp_path/'upload.mp4';make_video(source,60)
    assert prepare_video(source,output,'video/mp4')==60
    assert 0<output.stat().st_size<=MAX_VIDEO_OUTPUT

def test_source_copy_enforces_size_and_rejects_empty_files(tmp_path):
    assert copy_limited(BytesIO(b'1234'),tmp_path/'copy',4)==4
    for content,limit in [(b'12345',4),(b'',4)]:
        with pytest.raises(HTTPException):copy_limited(BytesIO(content),tmp_path/'copy',limit)

@pytest.mark.parametrize('hdr',[False,True])
def test_high_resolution_phone_copy_is_resized_and_hdr_is_tonemapped(tmp_path,hdr):
    source=tmp_path/'phone.mp4';output=tmp_path/'copy.mp4';binary=imageio_ffmpeg.get_ffmpeg_exe()
    tags=['-color_trc','smpte2084','-color_primaries','bt2020','-colorspace','bt2020nc'] if hdr else []
    result=subprocess.run([binary,'-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=2160x3840:r=60',
        '-t','1','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p',*tags,str(source)],capture_output=True,timeout=60)
    assert result.returncode==0
    assert prepare_video(source,output,'video/mp4')==1
    probe=subprocess.run([binary,'-hide_banner','-i',str(output)],capture_output=True,text=True,timeout=30)
    assert '1080x1920' in probe.stderr
    assert '30 fps' in probe.stderr
    assert 'smpte2084' not in probe.stderr
