self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('push',event=>{
  let payload={title:'업무 일정 알림',body:'확인할 업무가 있습니다.',data:{url:'/'}};
  try{if(event.data)payload={...payload,...event.data.json()}}catch{
    try{payload.body=event.data?.text()||payload.body}catch{}
  }
  const taskId=payload.data?.taskId||new URL(payload.data?.url||'/',self.location.origin).searchParams.get('task');
  const options={
    body:payload.body||'',
    icon:'./icon-192.png',
    badge:'./icon-192.png',
    tag:payload.tag||'workflow-task-reminder',
    data:{...(payload.data||{url:'/'}),taskId},
    vibrate:[180,90,180]
  };
  if(taskId){
    options.actions=[
      {action:'snooze30',title:'30분 뒤'},
      {action:'open',title:'열기'}
    ];
  }
  event.waitUntil(self.registration.showNotification(payload.title||'업무 일정 알림',options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const taskId=event.notification.data?.taskId;
  let raw=event.notification.data?.url||'/';
  if(event.action==='snooze30'&&taskId){raw=`/?task=${encodeURIComponent(taskId)}&snooze=30`}
  const target=new URL(raw,self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(new URL(client.url).origin===self.location.origin){
        try{await client.navigate(target)}catch{}
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).catch(()=>new Response('오프라인 상태입니다.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
});
