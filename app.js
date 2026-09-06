(() => {
  'use strict'

  const root = document.getElementById('root')
  const initialHashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const initialQueryParams = new URLSearchParams(window.location.search)
  const initialAuthType = initialHashParams.get('type') || initialQueryParams.get('type') || ''
  const cfg = window.TRADEFLOW_CONFIG || {}
  const isConfigured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !String(cfg.SUPABASE_URL).includes('YOUR_PROJECT')
  const client = isConfigured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null

  const state = {
    session: null,
    workspaces: [],
    workspace: null,
    page: 'dashboard',
    shipments: [],
    documents: [],
    activities: [],
    partners: [],
    members: [],
    selected: null,
    selectedDocs: [],
    selectedComments: [],
    selectedExternalMembers: [],
    selectedExternalAccess: [],
    showCreate: false,
    showPassword: false,
    busy: false,
    realtime: null,
    flash: '',
    authMode: initialAuthType === 'invite' || initialAuthType === 'recovery' ? 'set-password' : 'login'
  }

  const nav = [
    ['dashboard', '▦', '대시보드'],
    ['shipments', '↔', '수입 / 수출건'],
    ['schedule', '□', '일정'],
    ['documents', '▤', '서류'],
    ['partners', '◇', '거래처'],
    ['team', '◎', '팀']
  ]

  const statusLabel = {
    normal: '정상', watch: '확인 필요', risk: '지연 위험', complete: '완료',
    pending: '준비 전', requested: '요청', in_progress: '진행 중', issue: '문제 발생'
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch])
  }
  function fmtDate(value) {
    if (!value) return '-'
    const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
    if (Number.isNaN(d.getTime())) return esc(value)
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(d)
  }
  function daysFromToday(value) {
    if (!value) return null
    const today = new Date(); today.setHours(0,0,0,0)
    const d = new Date(`${value}T00:00:00`)
    return Math.round((d.getTime() - today.getTime()) / 86400000)
  }
  function deadlineHtml(date) {
    if (!date) return '<span class="muted">-</span>'
    const d = daysFromToday(date)
    const cls = d < 0 ? 'deadline late' : d <= 2 ? 'deadline soon' : 'deadline'
    const suffix = d === 0 ? ' · 오늘' : d > 0 ? ` · D-${d}` : ` · ${Math.abs(d)}일 지남`
    return `<span class="${cls}">${fmtDate(date)}${suffix}</span>`
  }
  function safeFileName(name) {
    return String(name || 'file').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0,120)
  }
  function roleText(role) {
    return role === 'admin' ? '관리자' : role === 'external' ? '외부 협력사' : '직원'
  }
  function isInternal() { return state.workspace && state.workspace.role !== 'external' }
  function isAdmin() { return state.workspace && state.workspace.role === 'admin' }

  function setupScreen() {
    root.innerHTML = `<div class="center-page"><div class="setup-card">
      <div class="brand-mark">TF</div><h1>TradeFlow Secure</h1>
      <p>Supabase 연결 정보가 아직 설정되지 않았습니다.</p>
      <div class="setup-steps"><b>1.</b> Supabase 프로젝트 생성<br><b>2.</b> <code>supabase/schema.sql</code> 실행<br><b>3.</b> Cloudflare Pages에 <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code> 환경변수 등록</div>
      <p class="muted">service_role 키는 브라우저나 GitHub에 절대 넣지 마세요.</p>
    </div></div>`
  }

  function renderAuth() {
    root.innerHTML = `<div class="auth-page">
      <section class="auth-hero"><div class="hero-inner"><span class="eyebrow">SECURE TRADE WORKSPACE</span><h1>반복되는 무역 업무를<br>한 곳에서 줄이세요.</h1><p>선적 일정, 서류, 거래처, 팀 협업을 하나의 보안 워크스페이스에서 관리합니다.</p><div class="hero-points"><span>✓ 팀별 데이터 분리</span><span>✓ 비공개 서류 저장</span><span>✓ 변경 이력</span></div></div></section>
      <section class="auth-panel"><form id="auth-form" class="auth-card"><div class="logo-line"><div class="brand-mark small">TF</div><strong>TradeFlow</strong></div><h2>로그인</h2><p class="muted">회사 또는 팀 워크스페이스에 안전하게 접속합니다.</p>
        <label>이메일<input name="email" type="email" required autocomplete="email"></label>
        <label>비밀번호<input name="password" type="password" required minlength="8" autocomplete="current-password"></label>
        ${state.flash ? `<div class="form-message">${esc(state.flash)}</div>` : ''}
        <button class="primary wide" ${state.busy ? 'disabled' : ''}>${state.busy ? '처리 중...' : '로그인'}</button>
        <div class="form-message">계정은 관리자가 승인·초대한 사용자만 사용할 수 있습니다.</div>
      </form></section>
    </div>`
  }

  function renderSetPassword() {
    root.innerHTML = `<div class="auth-page">
      <section class="auth-hero"><div class="hero-inner"><span class="eyebrow">SECURE TRADE WORKSPACE</span><h1>초대가 확인되었습니다.<br>비밀번호를 설정하세요.</h1><p>이 비밀번호는 앞으로 TradeFlow에 로그인할 때 사용합니다.</p><div class="hero-points"><span>✓ 초대 전용 가입</span><span>✓ 팀별 데이터 분리</span><span>✓ 비공개 서류 저장</span></div></div></section>
      <section class="auth-panel"><form id="password-setup" class="auth-card"><div class="logo-line"><div class="brand-mark small">TF</div><strong>TradeFlow</strong></div><h2>비밀번호 설정</h2><p class="muted">8자 이상의 새 비밀번호를 입력하세요.</p>
        <label>새 비밀번호<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>비밀번호 확인<input name="password_confirm" type="password" required minlength="8" autocomplete="new-password"></label>
        ${state.flash ? `<div class="form-message">${esc(state.flash)}</div>` : ''}
        <button class="primary wide" ${state.busy ? 'disabled' : ''}>${state.busy ? '저장 중...' : '비밀번호 설정 완료'}</button>
        <div class="form-message">초대받은 이메일 계정에만 적용됩니다.</div>
      </form></section>
    </div>`
  }

  function renderOnboarding() {
    const userEmail = state.session?.user?.email || ''
    root.innerHTML = `<div class="center-page"><div class="onboard-card"><div class="brand-mark">TF</div><h1>첫 워크스페이스 만들기</h1><p>회사명, 팀명 또는 프로젝트명으로 만들 수 있습니다.</p>
      <div class="onboard-grid"><form id="workspace-create"><h3>새로 만들기</h3><input name="name" placeholder="예: Korea Import Team" required minlength="2"><button class="primary wide">워크스페이스 생성</button></form><div class="divider-or">또는</div><form id="workspace-join"><h3>초대받아 참여</h3><input name="code" placeholder="초대 코드" required><button class="secondary wide">팀 참여하기</button></form></div>${state.flash ? `<div class="form-message">${esc(state.flash)}</div>` : ''}
      <div style="margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center"><small class="muted">${esc(userEmail)} 계정으로 로그인 중</small><div style="margin-top:10px"><button type="button" class="secondary" data-action="logout">← 로그인 화면으로 돌아가기</button></div></div>
    </div></div>`
  }

  function renderApp() {
    const ws = state.workspace
    const user = state.session.user
    root.innerHTML = `<div class="app-shell">
      <aside class="sidebar"><div class="sidebar-brand"><div class="brand-mark small">TF</div><div><strong>TradeFlow</strong><small>Secure Workspace</small></div></div>
        <nav>${nav.map(([id, icon, label]) => `<button data-page="${id}" class="${state.page === id ? 'active' : ''}"><span>${icon}</span>${label}</button>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="user-chip"><div class="avatar">${esc((user.email || 'U')[0].toUpperCase())}</div><div><b>${esc(user.user_metadata?.full_name || '사용자')}</b><small>${esc(user.email || '')}</small></div></div><button class="secondary mini wide" data-action="open-password">비밀번호 변경</button><button class="logout" data-action="logout">로그아웃</button></div>
      </aside>
      <main class="main"><header class="topbar"><div><select id="workspace-select" class="workspace-select">${state.workspaces.map(w => `<option value="${esc(w.id)}" ${w.id === ws.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select><span class="role-badge ${esc(ws.role)}">${roleText(ws.role)}</span>${isAdmin() ? '<button class="danger-ghost mini" data-action="delete-workspace" title="선택한 워크스페이스 삭제">워크스페이스 삭제</button>' : ''}</div>${isInternal() ? '<button class="primary" data-action="open-create">+ 새 업무 등록</button>' : ''}</header><div class="content">${pageHtml()}</div></main>
      ${state.showCreate ? createModalHtml() : ''}
      ${state.showPassword ? passwordModalHtml() : ''}
      ${state.selected ? drawerHtml() : ''}
    </div>`
  }

  function pageHtml() {
    if (state.page === 'shipments') return shipmentsHtml()
    if (state.page === 'schedule') return scheduleHtml()
    if (state.page === 'documents') return documentsHtml()
    if (state.page === 'partners') return partnersHtml()
    if (state.page === 'team') return teamHtml()
    return dashboardHtml()
  }

  function dashboardHtml() {
    const active = state.shipments.filter(s => s.status !== 'complete')
    const due = active.filter(s => s.etd).slice().sort((a,b) => String(a.etd).localeCompare(String(b.etd))).slice(0,5)
    const incompleteDocs = state.documents.filter(d => d.status !== 'complete').length
    return `<div class="page-heading"><span class="eyebrow dark">OVERVIEW</span><h1>무역 업무 현황</h1><p>문제가 생길 가능성이 있는 업무부터 빠르게 확인하세요.</p></div>
      <div class="stats-grid">${stat('진행 중', active.length, '현재 진행 업무')}${stat('정상', active.filter(s=>s.status==='normal').length, '일정대로 진행', 'good')}${stat('확인 필요', active.filter(s=>s.status==='watch').length, '담당자 확인 필요', 'warn')}${stat('지연 위험', active.filter(s=>s.status==='risk').length, '즉시 확인 권장', 'risk')}</div>
      <div class="dashboard-grid"><section class="panel span2"><div class="panel-head"><div><h2>가까운 선적 일정</h2><small>ETD 기준</small></div><span class="count-pill">미완료 서류 ${incompleteDocs}</span></div><div class="schedule-list">${due.length ? due.map(scheduleRow).join('') : empty('등록된 선적 일정이 없습니다.')}</div></section>
      <section class="panel"><div class="panel-head"><div><h2>최근 활동</h2><small>변경 이력</small></div></div><div class="activity-list">${state.activities.length ? state.activities.slice(0,7).map(activityRow).join('') : empty('최근 활동이 없습니다.')}</div></section></div>`
  }

  function stat(title, value, note, tone='') { return `<div class="stat-card ${tone}"><span>${esc(title)}</span><strong>${Number(value)}</strong><small>${esc(note)}</small></div>` }
  function scheduleRow(s) {
    const etdDate = new Date(`${s.etd}T00:00:00`)
    return `<button class="schedule-row" data-open-shipment="${esc(s.id)}"><div class="date-block"><b>${etdDate.getDate()}</b><small>${esc(etdDate.toLocaleString('en',{month:'short'}).toUpperCase())}</small></div><div class="grow"><b>${esc(s.reference_no)}</b><span>${esc(s.partner_name)} · ${esc(s.item_name)}</span></div><span class="status ${esc(s.status)}">${statusLabel[s.status] || esc(s.status)}</span><div class="date-right"><b>ETD ${fmtDate(s.etd)}</b><small>ETA ${fmtDate(s.eta)}</small></div></button>`
  }
  function activityRow(a) {
    const ref = a.metadata?.reference_no || a.metadata?.doc_type || '업무'
    let text = `${ref} 변경 사항이 기록되었습니다.`
    if (a.action === 'shipment_created') text = `${ref} 업무가 등록되었습니다.`
    if (a.action === 'shipment_updated') text = `${ref} 업무가 수정되었습니다.`
    if (a.action === 'document_updated') text = `${ref} 서류 상태가 변경되었습니다.`
    if (a.action === 'document_created') text = `${ref} 서류 항목이 생성되었습니다.`
    return `<div class="activity"><i></i><div><b>${esc(text)}</b><small>${esc(new Date(a.created_at).toLocaleString('ko-KR'))}</small></div></div>`
  }

  function shipmentsHtml() {
    return `<div class="page-heading row"><div><span class="eyebrow dark">SHIPMENTS</span><h1>수입 / 수출건</h1><p>한 번 등록한 거래는 복사해서 반복 입력을 줄일 수 있습니다.</p></div>${isInternal() ? '<button class="primary" data-action="open-create">+ 새 업무 등록</button>' : ''}</div>
      <section class="panel table-panel"><table><thead><tr><th>업무번호</th><th>구분</th><th>거래처 / 품목</th><th>운송</th><th>ETD</th><th>ETA</th><th>서류 마감</th><th>상태</th></tr></thead><tbody>${state.shipments.map(s => `<tr data-open-shipment="${esc(s.id)}"><td><b>${esc(s.reference_no)}</b><small>${esc(s.country)}</small></td><td><span class="soft-pill">${s.direction === 'import' ? '수입' : '수출'}</span></td><td><b>${esc(s.partner_name)}</b><small>${esc(s.item_name)}</small></td><td>${esc(String(s.transport).toUpperCase())}</td><td>${fmtDate(s.etd)}</td><td>${fmtDate(s.eta)}</td><td>${deadlineHtml(s.document_deadline)}</td><td><span class="status ${esc(s.status)}">${statusLabel[s.status] || esc(s.status)}</span></td></tr>`).join('')}</tbody></table>${state.shipments.length ? '' : empty('등록된 업무가 없습니다.')}</section>`
  }

  function scheduleHtml() {
    const events = []
    state.shipments.forEach(s => {
      if (s.document_deadline) events.push({date:s.document_deadline,type:'서류 마감',s})
      if (s.cargo_ready_date) events.push({date:s.cargo_ready_date,type:'화물 준비',s})
      if (s.etd) events.push({date:s.etd,type:'ETD',s})
      if (s.eta) events.push({date:s.eta,type:'ETA',s})
    })
    events.sort((a,b)=>String(a.date).localeCompare(String(b.date)))
    return `<div class="page-heading"><span class="eyebrow dark">SCHEDULE</span><h1>일정</h1><p>서류 마감, 화물 준비, 출항·도착 일정을 날짜순으로 확인합니다.</p></div><section class="panel"><div class="timeline">${events.length ? events.map(e => `<button class="timeline-row" data-open-shipment="${esc(e.s.id)}"><div class="timeline-date"><b>${fmtDate(e.date)}</b><small>${e.type === '서류 마감' ? deadlineHtml(e.date) : ''}</small></div><span class="event-type">${esc(e.type)}</span><div class="grow"><b>${esc(e.s.reference_no)}</b><small>${esc(e.s.partner_name)} · ${esc(e.s.item_name)}</small></div><span class="status ${esc(e.s.status)}">${statusLabel[e.s.status]}</span></button>`).join('') : empty('등록된 일정이 없습니다.')}</div></section>`
  }

  function documentsHtml() {
    return `<div class="page-heading"><span class="eyebrow dark">DOCUMENTS</span><h1>서류</h1><p>선적건별 서류 준비 상태를 한 곳에서 확인합니다.</p></div><div class="stats-grid docs">${stat('전체',state.documents.length,'서류 항목')}${stat('완료',state.documents.filter(d=>d.status==='complete').length,'수령 또는 업로드 완료','good')}${stat('진행 중',state.documents.filter(d=>['requested','in_progress'].includes(d.status)).length,'요청/발급 대기','warn')}${stat('문제',state.documents.filter(d=>d.status==='issue').length,'확인 필요','risk')}</div>
      <section class="panel table-panel"><table><thead><tr><th>업무번호</th><th>서류</th><th>파일</th><th>상태</th></tr></thead><tbody>${state.documents.map(d => { const s=state.shipments.find(x=>x.id===d.shipment_id); return `<tr data-open-shipment="${esc(d.shipment_id)}"><td><b>${esc(s?.reference_no || '-')}</b><small>${esc(s?.partner_name || '')}</small></td><td>${esc(d.doc_type)}</td><td>${d.original_name ? esc(d.original_name) : '<span class="muted">미업로드</span>'}</td><td><span class="doc-status ${esc(d.status)}">${statusLabel[d.status] || esc(d.status)}</span></td></tr>` }).join('')}</tbody></table></section>`
  }

  function partnersHtml() {
    if (!isInternal()) return restricted()
    return `<div class="page-heading"><span class="eyebrow dark">PARTNERS</span><h1>거래처</h1><p>자주 쓰는 공급사·포워더·관세사를 저장해 반복 입력을 줄입니다.</p></div>
      <section class="panel compact-form"><form id="partner-form"><input name="name" placeholder="거래처명" required><select name="kind"><option value="supplier">공급사</option><option value="customer">고객사</option><option value="forwarder">포워더</option><option value="broker">관세사</option><option value="other">기타</option></select><input name="country" placeholder="국가"><button class="primary">저장</button></form></section>
      <section class="cards-grid">${state.partners.map(p => `<div class="partner-card"><span class="soft-pill">${({supplier:'공급사',customer:'고객사',forwarder:'포워더',broker:'관세사',other:'기타'})[p.kind] || esc(p.kind)}</span><h3>${esc(p.name)}</h3><p>${esc(p.country || '국가 미지정')}</p></div>`).join('')}</section>`
  }

  function teamHtml() {
    if (!isInternal()) return restricted()
    const ws = state.workspace
    return `<div class="page-heading"><span class="eyebrow dark">TEAM</span><h1>팀과 권한</h1><p>관리자, 직원, 외부 협력사의 접근 범위를 분리합니다.</p></div><div class="team-grid"><section class="panel"><div class="panel-head"><div><h2>팀원</h2><small>${state.members.length}명</small></div></div><div class="member-list">${state.members.map(m => `<div class="member"><div class="avatar">${esc((m.full_name || m.email || 'U')[0].toUpperCase())}</div><div class="grow"><b>${esc(m.full_name || '이름 미설정')} ${m.user_id === state.session.user.id ? '<small>(나)</small>' : ''}</b><span>${esc(m.email || '')}</span></div>${isAdmin() ? `<select data-role-user="${esc(m.user_id)}"><option value="admin" ${m.role==='admin'?'selected':''}>관리자</option><option value="member" ${m.role==='member'?'selected':''}>직원</option><option value="external" ${m.role==='external'?'selected':''}>외부 협력사</option></select>` : `<span class="role-badge ${esc(m.role)}">${roleText(m.role)}</span>`}</div>`).join('')}</div></section>
      <section class="panel invite-panel"><h2>팀 초대</h2><p>가입한 사용자가 이 코드를 입력하면 팀에 참여합니다. 가입 후 관리자가 역할을 조정하세요.</p><div class="invite-code">${esc(ws.invite_code || '권한 없음')}</div><div class="invite-actions"><button class="secondary" data-action="copy-invite">코드 복사</button>${isAdmin()?'<button class="danger-ghost" data-action="regen-invite">코드 재발급</button>':''}</div><div class="security-note"><b>외부 협력사</b><br>외부 협력사는 전체 업무를 볼 수 없습니다. 관리자가 별도로 공유한 선적건만 접근합니다.</div></section></div>`
  }

  function createModalHtml() {
    return `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal"><div class="modal-head"><h2>새 무역 업무 등록</h2><button class="icon-btn" data-action="close-create">×</button></div><form id="shipment-create" class="form-grid">
      <label>업무번호<input name="reference_no" placeholder="예: IMP-260905-01" required></label><label>구분<select name="direction"><option value="import">수입</option><option value="export">수출</option></select></label>
      <label>거래처<input name="partner_name" required></label><label>국가<input name="country"></label><label class="span2">품목<input name="item_name" required></label>
      <label>운송<select name="transport"><option value="sea">SEA</option><option value="air">AIR</option></select></label><label>Incoterms<input name="incoterm" placeholder="FOB, CIF..."></label>
      <label>화물 준비일<input name="cargo_ready_date" type="date"></label><label>ETD<input name="etd" type="date"></label><label>ETA<input name="eta" type="date"></label>
      <label>서류 신청 리드타임<small>주말 제외 영업일</small><input name="document_lead_business_days" type="number" min="0" max="60" value="0"></label>
      <div class="modal-actions span2"><button type="button" class="secondary" data-action="close-create">취소</button><button class="primary">업무 등록</button></div></form></div></div>`
  }

  function passwordModalHtml() {
    return `<div class="modal-backdrop" data-action="close-password-bg"><div class="modal"><div class="modal-head"><h2>비밀번호 변경</h2><button class="icon-btn" data-action="close-password">×</button></div><form id="password-change" class="form-grid">
      <label class="span2">현재 비밀번호<input name="current_password" type="password" required minlength="8" autocomplete="current-password"></label>
      <label>새 비밀번호<input name="new_password" type="password" required minlength="8" autocomplete="new-password"></label>
      <label>새 비밀번호 확인<input name="new_password_confirm" type="password" required minlength="8" autocomplete="new-password"></label>
      <div class="modal-actions span2"><button type="button" class="secondary" data-action="close-password">취소</button><button class="primary">비밀번호 변경</button></div></form></div></div>`
  }

  function drawerHtml() {
    const s = state.selected
    return `<div class="drawer-backdrop" data-action="close-drawer-bg"><aside class="drawer"><div class="drawer-head"><div><span class="eyebrow dark">${s.direction === 'import' ? 'IMPORT' : 'EXPORT'} · ${esc(String(s.transport).toUpperCase())}</span><h2>${esc(s.reference_no)}</h2><p>${esc(s.partner_name)} · ${esc(s.item_name)}</p></div><button class="icon-btn" data-action="close-drawer">×</button></div><div class="drawer-body">
      <div class="detail-status"><span>진행 상태</span><select id="shipment-status"><option value="normal" ${s.status==='normal'?'selected':''}>정상</option><option value="watch" ${s.status==='watch'?'selected':''}>확인 필요</option><option value="risk" ${s.status==='risk'?'selected':''}>지연 위험</option><option value="complete" ${s.status==='complete'?'selected':''}>완료</option></select>${isInternal()?'<button class="secondary mini" data-action="duplicate-shipment">이전 건 복사</button>':''}${isAdmin()?'<button class="danger-ghost mini" data-action="delete-shipment">업무 삭제</button>':''}</div>
      <div class="detail-grid"><div><small>국가</small><b>${esc(s.country || '-')}</b></div><div><small>Incoterms</small><b>${esc(s.incoterm || '-')}</b></div><div><small>화물 준비</small><b>${fmtDate(s.cargo_ready_date)}</b></div><div><small>ETD</small><b>${fmtDate(s.etd)}</b></div><div><small>ETA</small><b>${fmtDate(s.eta)}</b></div><div><small>서류 신청 마감</small><b>${deadlineHtml(s.document_deadline)}</b></div></div>
      <section class="drawer-section"><div class="section-title"><h3>서류 체크리스트</h3><small>파일은 비공개 Storage에 저장됩니다.</small></div>${state.selectedDocs.map(docRowHtml).join('')}</section>
      ${isAdmin() && state.selectedExternalMembers.length ? `<section class="drawer-section"><div class="section-title"><h3>외부 협력사 공유</h3><small>이 선적건만 별도로 허용합니다.</small></div>${state.selectedExternalMembers.map(m => `<label class="share-row"><input type="checkbox" data-share-user="${esc(m.user_id)}" ${state.selectedExternalAccess.includes(m.user_id)?'checked':''}><div><b>${esc(m.full_name || m.email || '사용자')}</b><small>${esc(m.email || '')}</small></div></label>`).join('')}</section>` : ''}
      <section class="drawer-section"><div class="section-title"><h3>댓글 / 업무 메모</h3><small>팀원과 진행상황을 남기세요.</small></div><div class="comments">${state.selectedComments.map(c => `<div class="comment"><div class="avatar tiny">${esc((c.profile?.full_name || c.profile?.email || 'U')[0].toUpperCase())}</div><div><b>${esc(c.profile?.full_name || c.profile?.email || '사용자')}</b><p>${esc(c.body)}</p><small>${esc(new Date(c.created_at).toLocaleString('ko-KR'))}</small></div></div>`).join('')}</div><form id="comment-form" class="comment-form"><textarea name="body" placeholder="예: 검역서류 공급사에 요청했습니다." required></textarea><button class="primary">등록</button></form></section>
    </div></aside></div>`
  }

  function docRowHtml(doc) {
    return `<div class="doc-row"><div class="grow"><b>${esc(doc.doc_type)}</b><small>${esc(doc.original_name || '파일 없음')}</small></div><select data-doc-status="${esc(doc.id)}"><option value="pending" ${doc.status==='pending'?'selected':''}>준비 전</option><option value="requested" ${doc.status==='requested'?'selected':''}>요청</option><option value="in_progress" ${doc.status==='in_progress'?'selected':''}>진행 중</option><option value="complete" ${doc.status==='complete'?'selected':''}>완료</option><option value="issue" ${doc.status==='issue'?'selected':''}>문제 발생</option></select>${doc.storage_path?`<button class="secondary mini" data-download-doc="${esc(doc.id)}">열기</button>`:''}<label class="upload-btn">파일 업로드<input type="file" hidden data-upload-doc="${esc(doc.id)}"></label></div>`
  }
  function restricted() { return '<div class="restricted"><span>🔒</span><h2>접근 권한이 없습니다.</h2><p>외부 협력사는 공유받은 선적건만 이용할 수 있습니다.</p></div>' }
  function empty(text) { return `<div class="empty">${esc(text)}</div>` }

  async function init() {
    if (!isConfigured || !client) { setupScreen(); return }
    const { data } = await client.auth.getSession()
    state.session = data.session
    client.auth.onAuthStateChange((event, session) => {
      state.session = session
      if (event === 'PASSWORD_RECOVERY') {
        state.authMode = 'set-password'
        state.flash = ''
        renderSetPassword()
        return
      }
      if (!session) {
        state.authMode = 'login'
        state.workspace = null; state.workspaces = []; state.shipments=[]; state.documents=[]; state.activities=[]
        renderAuth()
      }
    })
    if (!state.session) { renderAuth(); return }
    if (state.authMode === 'set-password') { renderSetPassword(); return }
    await loadWorkspaces()
  }

  async function loadWorkspaces() {
    if (!client || !state.session) return
    const { data: memberships, error } = await client.from('workspace_members').select('workspace_id,role')
    if (error) { state.flash = error.message; renderOnboarding(); return }
    const ids = (memberships || []).map(m => m.workspace_id)
    if (!ids.length) { state.workspaces=[]; state.workspace=null; renderOnboarding(); return }
    const { data: ws, error: wsErr } = await client.from('workspaces').select('id,name').in('id', ids)
    if (wsErr) { state.flash=wsErr.message; renderOnboarding(); return }
    const inviteResult = await client.from('workspace_invites').select('workspace_id,invite_code').in('workspace_id', ids)
    const invites = inviteResult.data || []
    state.workspaces = (ws || []).map(w => ({...w, invite_code: invites.find(i => i.workspace_id === w.id)?.invite_code || '', role: memberships.find(m => m.workspace_id === w.id)?.role || 'member'}))
    const saved = localStorage.getItem('tradeflow-workspace')
    state.workspace = state.workspaces.find(w => w.id === saved) || state.workspaces[0]
    localStorage.setItem('tradeflow-workspace', state.workspace.id)
    await loadWorkspaceData()
    subscribeRealtime()
    renderApp()
  }

  async function loadWorkspaceData() {
    if (!client || !state.workspace) return
    const wid = state.workspace.id
    const [s,d,a] = await Promise.all([
      client.from('shipments').select('*').eq('workspace_id',wid).order('created_at',{ascending:false}),
      client.from('documents').select('*').eq('workspace_id',wid).order('created_at',{ascending:false}),
      client.from('activities').select('id,action,metadata,created_at,actor_id').eq('workspace_id',wid).order('created_at',{ascending:false}).limit(20)
    ])
    if (!s.error) state.shipments = s.data || []
    if (!d.error) state.documents = d.data || []
    if (!a.error) state.activities = a.data || []
    if (isInternal()) await Promise.all([loadPartners(), loadMembers()])
  }

  async function loadPartners() {
    if (!client || !state.workspace || !isInternal()) return
    const { data } = await client.from('partners').select('*').eq('workspace_id',state.workspace.id).order('name')
    state.partners = data || []
  }

  async function loadMembers() {
    if (!client || !state.workspace || !isInternal()) return
    const { data } = await client.from('workspace_members').select('user_id,role').eq('workspace_id',state.workspace.id)
    const members = data || []
    const ids = members.map(m=>m.user_id)
    let profiles = []
    if (ids.length) {
      const r = await client.from('profiles').select('id,full_name,email').in('id',ids)
      profiles = r.data || []
    }
    state.members = members.map(m => ({...m, ...(profiles.find(p=>p.id===m.user_id) || {})}))
  }

  function subscribeRealtime() {
    if (!client || !state.workspace) return
    if (state.realtime) client.removeChannel(state.realtime)
    const wid = state.workspace.id
    state.realtime = client.channel(`tradeflow-${wid}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'shipments',filter:`workspace_id=eq.${wid}`}, async ()=>{await loadWorkspaceData(); renderApp()})
      .on('postgres_changes',{event:'*',schema:'public',table:'documents',filter:`workspace_id=eq.${wid}`}, async ()=>{await loadWorkspaceData(); if(state.selected) await openShipment(state.selected.id,false); else renderApp()})
      .subscribe()
  }

  async function openShipment(id, render=true) {
    if (!client) return
    const found = state.shipments.find(s=>s.id===id)
    if (!found) return
    state.selected = found
    const [d,c] = await Promise.all([
      client.from('documents').select('*').eq('shipment_id',id).order('created_at'),
      client.from('comments').select('id,body,created_at,created_by').eq('shipment_id',id).order('created_at',{ascending:true})
    ])
    state.selectedDocs = d.data || []
    const comments = c.data || []
    const pids = [...new Set(comments.map(x=>x.created_by))]
    let profiles=[]
    if (pids.length) { const p=await client.from('profiles').select('id,full_name,email').in('id',pids); profiles=p.data||[] }
    state.selectedComments = comments.map(x=>({...x,profile:profiles.find(p=>p.id===x.created_by)||null}))
    state.selectedExternalMembers=[]; state.selectedExternalAccess=[]
    if (isAdmin()) {
      state.selectedExternalMembers = state.members.filter(m=>m.role==='external')
      const a = await client.from('shipment_access').select('user_id').eq('shipment_id',id)
      state.selectedExternalAccess = (a.data||[]).map(x=>x.user_id)
    }
    if (render) renderApp()
  }

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-action],[data-page],[data-open-shipment],[data-download-doc]')
    if (!t) return
    if (t.dataset.page) { state.page=t.dataset.page; renderApp(); return }
    if (t.dataset.openShipment) { await openShipment(t.dataset.openShipment); return }
    if (t.dataset.downloadDoc) { await downloadDoc(t.dataset.downloadDoc); return }
    const a=t.dataset.action
    if (a==='logout') await client.auth.signOut()
    if (a==='open-create') { state.showCreate=true; renderApp() }
    if (a==='close-create') { state.showCreate=false; renderApp() }
    if (a==='open-password') { state.showPassword=true; renderApp() }
    if (a==='close-password') { state.showPassword=false; renderApp() }
    if (a==='close-drawer') { state.selected=null; renderApp() }
    if (a==='copy-invite') { await navigator.clipboard.writeText(state.workspace.invite_code||''); alert('초대 코드를 복사했습니다.') }
    if (a==='regen-invite') await regenerateInvite()
    if (a==='duplicate-shipment') await duplicateShipment()
    if (a==='delete-shipment') await deleteShipment()
    if (a==='delete-workspace') await deleteWorkspace()
    if (a==='close-password-bg' && e.target===t) { state.showPassword=false; renderApp() }
    if (a==='close-modal-bg' && e.target===t) { state.showCreate=false; renderApp() }
    if (a==='close-drawer-bg' && e.target===t) { state.selected=null; renderApp() }
  })

  document.addEventListener('change', async e => {
    const t=e.target
    if (t.id==='workspace-select') {
      state.workspace=state.workspaces.find(w=>w.id===t.value) || state.workspace
      localStorage.setItem('tradeflow-workspace',state.workspace.id)
      state.selected=null
      await loadWorkspaceData(); subscribeRealtime(); renderApp(); return
    }
    if (t.id==='shipment-status' && state.selected) {
      const { error } = await client.from('shipments').update({status:t.value}).eq('id',state.selected.id)
      if (error) alert(error.message); else { await loadWorkspaceData(); state.selected=state.shipments.find(s=>s.id===state.selected.id)||state.selected; await openShipment(state.selected.id) }
      return
    }
    if (t.dataset.docStatus) {
      const { error } = await client.from('documents').update({status:t.value}).eq('id',t.dataset.docStatus)
      if (error) alert(error.message); else { await loadWorkspaceData(); await openShipment(state.selected.id) }
      return
    }
    if (t.dataset.roleUser) {
      const { error } = await client.rpc('set_member_role',{p_workspace:state.workspace.id,p_user:t.dataset.roleUser,p_role:t.value})
      if (error) alert(error.message); await loadMembers(); renderApp(); return
    }
    if (t.dataset.shareUser) {
      const uid=t.dataset.shareUser
      if (t.checked) {
        const { error }=await client.from('shipment_access').insert({shipment_id:state.selected.id,workspace_id:state.workspace.id,user_id:uid,created_by:state.session.user.id})
        if (error) alert(error.message)
      } else {
        const { error }=await client.from('shipment_access').delete().eq('shipment_id',state.selected.id).eq('user_id',uid)
        if (error) alert(error.message)
      }
      await openShipment(state.selected.id)
      return
    }
    if (t.dataset.uploadDoc && t.files?.[0]) await uploadDoc(t.dataset.uploadDoc,t.files[0])
  })

  document.addEventListener('submit', async e => {
    const form=e.target
    e.preventDefault()
    if (form.id==='auth-form') await authSubmit(form)
    if (form.id==='password-setup') await passwordSetup(form)
    if (form.id==='password-change') await passwordChange(form)
    if (form.id==='workspace-create') await workspaceCreate(form)
    if (form.id==='workspace-join') await workspaceJoin(form)
    if (form.id==='shipment-create') await shipmentCreate(form)
    if (form.id==='partner-form') await partnerCreate(form)
    if (form.id==='comment-form') await commentCreate(form)
  })

  async function authSubmit(form) {
    state.busy=true; state.flash=''; renderAuth()
    const fd=new FormData(form), email=String(fd.get('email')||''), password=String(fd.get('password')||'')
    const { error }=await client.auth.signInWithPassword({email,password})
    if (error) { state.flash=error.message; state.busy=false; renderAuth(); return }
    state.busy=false
    const { data }=await client.auth.getSession(); state.session=data.session
    await loadWorkspaces()
  }

  async function passwordSetup(form) {
    const fd = new FormData(form)
    const password = String(fd.get('password') || '')
    const confirm = String(fd.get('password_confirm') || '')
    if (password.length < 8) { state.flash='비밀번호는 8자 이상이어야 합니다.'; renderSetPassword(); return }
    if (password !== confirm) { state.flash='비밀번호가 서로 일치하지 않습니다.'; renderSetPassword(); return }
    state.busy=true; state.flash=''; renderSetPassword()
    const { error } = await client.auth.updateUser({ password })
    if (error) { state.busy=false; state.flash=error.message; renderSetPassword(); return }
    state.busy=false; state.flash=''; state.authMode='login'
    window.history.replaceState({}, document.title, window.location.pathname)
    const { data } = await client.auth.getSession(); state.session = data.session
    if (!state.session) { state.flash='비밀번호 설정이 완료되었습니다. 로그인해주세요.'; renderAuth(); return }
    await loadWorkspaces()
  }

  async function passwordChange(form) {
    const fd = new FormData(form)
    const currentPassword = String(fd.get('current_password') || '')
    const newPassword = String(fd.get('new_password') || '')
    const confirmPassword = String(fd.get('new_password_confirm') || '')
    if (newPassword.length < 8) { alert('새 비밀번호는 8자 이상이어야 합니다.'); return }
    if (newPassword !== confirmPassword) { alert('새 비밀번호가 서로 일치하지 않습니다.'); return }
    const email = state.session?.user?.email
    if (!email) { alert('로그인 정보를 확인할 수 없습니다.'); return }
    const { error: verifyError } = await client.auth.signInWithPassword({ email, password: currentPassword })
    if (verifyError) { alert('현재 비밀번호가 올바르지 않습니다.'); return }
    const { error: updateError } = await client.auth.updateUser({ password: newPassword })
    if (updateError) { alert(updateError.message); return }
    state.showPassword = false
    alert('비밀번호가 변경되었습니다.')
    renderApp()
  }

  async function workspaceCreate(form) {
    const name=String(new FormData(form).get('name')||'').trim()
    const { error }=await client.rpc('create_workspace',{p_name:name})
    if (error) { state.flash=error.message; renderOnboarding(); return }
    state.flash=''; await loadWorkspaces()
  }
  async function workspaceJoin(form) {
    const code=String(new FormData(form).get('code')||'').trim().toUpperCase()
    const { error }=await client.rpc('join_workspace_by_code',{p_code:code})
    if (error) { state.flash='초대 코드를 확인해주세요.'; renderOnboarding(); return }
    state.flash=''; await loadWorkspaces()
  }
  async function shipmentCreate(form) {
    const fd=new FormData(form)
    const payload={
      workspace_id:state.workspace.id, created_by:state.session.user.id, owner_id:state.session.user.id,
      reference_no:String(fd.get('reference_no')||'').trim(), direction:String(fd.get('direction')||'import'),
      partner_name:String(fd.get('partner_name')||'').trim(), country:String(fd.get('country')||'').trim(), item_name:String(fd.get('item_name')||'').trim(), transport:String(fd.get('transport')||'sea'),
      cargo_ready_date:String(fd.get('cargo_ready_date')||'')||null, etd:String(fd.get('etd')||'')||null, eta:String(fd.get('eta')||'')||null,
      document_lead_business_days:Number(fd.get('document_lead_business_days')||0), incoterm:String(fd.get('incoterm')||'').trim().toUpperCase()||null
    }
    const { error }=await client.from('shipments').insert(payload)
    if (error) { alert(error.message); return }
    state.showCreate=false; await loadWorkspaceData(); renderApp()
  }
  async function partnerCreate(form) {
    const fd=new FormData(form)
    const payload={workspace_id:state.workspace.id,name:String(fd.get('name')||'').trim(),kind:String(fd.get('kind')||'supplier'),country:String(fd.get('country')||'').trim()||null,created_by:state.session.user.id}
    const { error }=await client.from('partners').insert(payload)
    if (error) alert(error.message); else { await loadPartners(); renderApp() }
  }
  async function commentCreate(form) {
    const body=String(new FormData(form).get('body')||'').trim(); if(!body)return
    const { error }=await client.from('comments').insert({workspace_id:state.workspace.id,shipment_id:state.selected.id,body,created_by:state.session.user.id})
    if (error) alert(error.message); else await openShipment(state.selected.id)
  }
  async function regenerateInvite() {
    if (!isAdmin()) return
    const { data,error }=await client.rpc('regenerate_invite_code',{p_workspace:state.workspace.id})
    if (error) alert(error.message); else { state.workspace.invite_code=data; const w=state.workspaces.find(x=>x.id===state.workspace.id); if(w)w.invite_code=data; renderApp() }
  }
  async function duplicateShipment() {
    const { error }=await client.rpc('duplicate_shipment',{p_shipment:state.selected.id})
    if (error) alert(error.message); else { state.selected=null; await loadWorkspaceData(); renderApp() }
  }

  async function deleteWorkspace() {
    if (!isAdmin() || !state.workspace) return
    const workspace = state.workspace
    const typed = window.prompt(`워크스페이스 "${workspace.name}"를 삭제합니다.\n\n이 안의 업무, 서류, 댓글, 거래처, 팀 권한 및 업로드 파일이 모두 삭제되며 되돌릴 수 없습니다.\n\n삭제하려면 워크스페이스 이름을 정확히 입력하세요.`, '')
    if (typed === null) return
    if (typed.trim() !== workspace.name) { alert('워크스페이스 이름이 일치하지 않아 삭제하지 않았습니다.'); return }

    const paths = (state.documents || []).map(d => d.storage_path).filter(Boolean)
    for (let i = 0; i < paths.length; i += 100) {
      const { error: storageError } = await client.storage.from('trade-docs').remove(paths.slice(i, i + 100))
      if (storageError) { alert(`첨부파일 삭제에 실패해 워크스페이스 삭제를 중단했습니다.\n${storageError.message}`); return }
    }

    const { error } = await client.rpc('delete_workspace', { p_workspace: workspace.id })
    if (error) { alert(error.message); return }

    if (state.realtime) { await client.removeChannel(state.realtime); state.realtime = null }
    localStorage.removeItem('tradeflow-workspace')
    state.workspace = null
    state.selected = null
    state.selectedDocs = []
    state.selectedComments = []
    state.shipments = []
    state.documents = []
    state.activities = []
    state.partners = []
    state.members = []
    await loadWorkspaces()
  }

  async function deleteShipment() {
    if (!isAdmin() || !state.selected) return
    const shipment = state.selected
    const ok = window.confirm(`업무 "${shipment.reference_no}"를 삭제하시겠습니까?\n\n관련 서류 체크리스트, 댓글, 공유 설정과 업로드 파일도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`)
    if (!ok) return
    const paths = (state.selectedDocs || []).map(d => d.storage_path).filter(Boolean)
    if (paths.length) {
      const { error: storageError } = await client.storage.from('trade-docs').remove(paths)
      if (storageError) { alert(`첨부파일 삭제에 실패해 업무 삭제를 중단했습니다.\n${storageError.message}`); return }
    }
    const { error } = await client.from('shipments').delete().eq('id', shipment.id).eq('workspace_id', state.workspace.id)
    if (error) { alert(error.message); return }
    state.selected = null
    state.selectedDocs = []
    state.selectedComments = []
    await loadWorkspaceData()
    renderApp()
  }
  async function uploadDoc(docId,file) {
    const doc=state.selectedDocs.find(d=>d.id===docId); if(!doc)return
    if (file.size > 50*1024*1024) { alert('파일은 50MB 이하만 업로드할 수 있습니다.'); return }
    const path=`${state.workspace.id}/${state.selected.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`
    const { error:upErr }=await client.storage.from('trade-docs').upload(path,file,{upsert:false,contentType:file.type||undefined})
    if (upErr) { alert(upErr.message); return }
    if (doc.storage_path) await client.storage.from('trade-docs').remove([doc.storage_path])
    const { error }=await client.from('documents').update({storage_path:path,original_name:file.name,uploaded_by:state.session.user.id,status:'complete'}).eq('id',doc.id)
    if (error) alert(error.message)
    await loadWorkspaceData(); await openShipment(state.selected.id)
  }
  async function downloadDoc(docId) {
    const doc=state.selectedDocs.find(d=>d.id===docId) || state.documents.find(d=>d.id===docId)
    if(!doc?.storage_path)return
    const { data,error }=await client.storage.from('trade-docs').createSignedUrl(doc.storage_path,60)
    if (error) alert(error.message); else window.open(data.signedUrl,'_blank','noopener,noreferrer')
  }

  init().catch(err => {
    console.error(err)
    root.innerHTML=`<div class="center-page"><div class="setup-card"><h1>앱을 시작하지 못했습니다.</h1><p>${esc(err.message||String(err))}</p></div></div>`
  })
})()
