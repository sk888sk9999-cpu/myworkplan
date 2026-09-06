self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('push',event=>{
  let payload={title:'업무 일정 알림',body:'확인할 업무가 있습니다.',data:{url:'/'}};
  try{if(event.data)payload={...payload,...event.data.json()}}catch{
    try{payload.body=event.data?.text()||payload.body}catch{}
  }
  const options={
    body:payload.body||'',
    icon:'./icon-192.png',
    badge:'./icon-192.png',
    tag:payload.tag||'workflow-task-reminder',
    data:payload.data||{url:'/'},
    vibrate:[180,90,180]
  };
  event.waitUntil(self.registration.showNotification(payload.title||'업무 일정 알림',options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
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
