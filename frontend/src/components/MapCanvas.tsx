import { useEffect,useRef,useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../game-map.css';
import type { GameMapState,MapPoint,MapStage } from '../lib/gameMap';
import {aggregateTeamLocations} from '../lib/gameMap';
const colors=['#14213d','#c2410c','#047857','#6d28d9','#0369a1'];
const color=(id:string)=>colors[[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%colors.length];
setWorkerUrl(workerUrl);
const attribution='&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

export default function MapCanvas({data,finish,preview,onChoose,teamNames={}}:{
  data?:GameMapState;finish?:MapPoint|null;preview?:MapStage[];onChoose?:(p:MapPoint)=>void;teamNames?:Record<string,string>;
}) {
  const container=useRef<HTMLDivElement>(null),map=useRef<L.Map>(),layers=useRef<L.LayerGroup>();
  const pins=useRef<L.LayerGroup>(),pinCache=useRef(new Map<string,{signature:string;layers:L.LayerGroup}>());
  const choose=useRef(onChoose);choose.current=onChoose;
  const [ready,setReady]=useState(false),[tileError,setTileError]=useState(false);
  useEffect(()=> {
    const current=L.map(container.current!,{scrollWheelZoom:false}).setView([1.32,103.85],11);
    map.current=current;layers.current=L.layerGroup().addTo(current);pins.current=L.layerGroup().addTo(current);
    pinCache.current.clear();
    current.attributionControl.setPrefix(false).addAttribution(attribution);
    try {
      const basemap=maplibreGL({
        style:import.meta.env.VITE_MAP_STYLE_URL??`${import.meta.env.BASE_URL}game-map-style.json`,
        attributionControl:false,
      }).addTo(current);
      basemap.getMaplibreMap().on('error',()=>setTileError(true));
      basemap.getCanvas().setAttribute('aria-hidden','true');
      basemap.getCanvas().removeAttribute('tabindex');
    } catch {
      // Keep the game overlays usable when WebGL is unavailable.
      setTileError(true);
    }
    const click=(event:L.LeafletMouseEvent)=>choose.current?.({lat:event.latlng.lat,lng:event.latlng.lng});
    current.on('click',click);
    const keyboard=(event:KeyboardEvent)=> {if(event.key==='Enter' && choose.current){event.preventDefault();const point=current.getCenter();choose.current({lat:point.lat,lng:point.lng});}};
    const element=container.current!;element.addEventListener('keydown',keyboard);
    const resize=new ResizeObserver(()=>current.invalidateSize());resize.observe(element);
    setReady(true);
    return ()=>{resize.disconnect();element.removeEventListener('keydown',keyboard);current.remove();map.current=undefined;};
  },[]);
  const boundarySignature=JSON.stringify([data?.initial_area,data?.area,finish,preview]);
  useEffect(()=> {
    if(!ready || !map.current || !layers.current)return;
    const group=layers.current;group.clearLayers();
    const circle=(area:MapStage,options:L.CircleMarkerOptions)=>L.circle([area.lat,area.lng],{radius:area.radius_m,...options}).addTo(group);
    if(data?.initial_area)circle(data.initial_area,{color:'#14213d',dashArray:'6 6',weight:2,fill:false}).bindTooltip('Starting playing area');
    for(const area of preview??[]) {
      if(data?.area&&area.lat===data.area.lat&&area.lng===data.area.lng&&area.radius_m===data.area.radius_m)continue;
      circle(area,{className:'map-zone-future',color:'#4b5563',dashArray:'1 7',lineCap:'round',weight:2,fill:false})
        .bindTooltip(`Upcoming shrink zone: ${area.radius_m/1000} km radius`);
    }
    if(data?.area)circle(data.area,{color:'#c2410c',weight:3,fillColor:'#ff6a13',fillOpacity:.10}).bindTooltip('Current playing area');
    if(finish)L.circleMarker([finish.lat,finish.lng],{radius:8,color:'#b91c1c',fillColor:'#b91c1c',fillOpacity:1}).addTo(group).bindTooltip('Hidden destination (host only)');
  },[ready,boundarySignature]);
  useEffect(()=> {
    if(!ready||!pins.current)return;
    const present=new Set<string>();
    for(const point of aggregateTeamLocations(data?.locations??[])) {
      const name=teamNames[point.team_id]??point.team_name;
      const id=point.team_id;present.add(id);
      const signature=JSON.stringify([point,name]);
      const previous=pinCache.current.get(id);
      if(previous?.signature===signature)continue;
      if(previous)pins.current.removeLayer(previous.layers);
      const group=L.layerGroup().addTo(pins.current);
      const tint=color(point.team_id);
      const label=document.createElement('span');label.className='map-team-pin';label.style.backgroundColor=tint;
      label.textContent=name.split(/\s+/).map(word=>word[0]).join('').slice(0,3).toUpperCase();
      const details=document.createElement('div');details.textContent=`${name} · ${point.device_count} shared device${point.device_count===1?'':'s'} · Estimated area ${Math.round(point.accuracy_m)} m`;
      L.circle([point.lat,point.lng],{radius:point.accuracy_m,color:tint,weight:1,fillOpacity:.05,interactive:false}).addTo(group);
      L.marker([point.lat,point.lng],{title:name,icon:L.divIcon({className:'map-pin-shell',html:label,iconSize:[32,32],iconAnchor:[16,16]})}).addTo(group).bindPopup(details);
      pinCache.current.set(id,{signature,layers:group});
    }
    for(const [id,entry] of pinCache.current)if(!present.has(id)){pins.current.removeLayer(entry.layers);pinCache.current.delete(id);}
  },[ready,data?.locations,teamNames]);
  const area=data?.area;
  useEffect(()=>{if(ready&&area&&map.current)map.current.fitBounds(L.latLng(area.lat,area.lng).toBounds(area.radius_m*2),{padding:[18,18],animate:false});},[ready,area?.lat,area?.lng,area?.radius_m]);
  return <div className="game-map-frame"><div className="game-map-canvas" ref={container} role="region" aria-label="Playing area map" />
    {tileError?<p className="map-tile-notice" role="status">Map tiles could not load. Area and location data are still available below.</p>:null}
  </div>;
}
