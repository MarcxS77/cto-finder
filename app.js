import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_KEY
const MAPBOX_TOKEN  = import.meta.env.VITE_MAPBOX_TOKEN
const TABLE         = 'ctos'
const credenciaisOk = !!SUPABASE_URL && !!SUPABASE_KEY

// Detecta redirect OAuth via sessionStorage (mais confiável que URL parsing)
const isOAuthRedirect = !!sessionStorage.getItem('oauth_pending') ||
                        window.location.hash.includes('access_token') ||
                        window.location.search.includes('code=')

let sb = null
if (credenciaisOk) {
  try {
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
      }
    })
  }
  catch (e) { console.error('Erro ao iniciar Supabase:', e) }
}

// ══════════════════════════════════════
//  AUTH
// ══════════════════════════════════════
let currentTab      = 'login'
let mapInitialized  = false
let currentUser     = null
let isAdmin         = false

window.switchTab = function (tab) {
  currentTab = tab
  document.getElementById('tab-login').classList.toggle('active', tab === 'login')
  document.getElementById('tab-registro').classList.toggle('active', tab === 'registro')
  document.getElementById('btn-auth-submit').textContent =
    tab === 'login' ? 'Entrar' : 'Criar conta'
  document.getElementById('auth-msg').textContent = ''
  document.getElementById('auth-msg').className = 'auth-msg'
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg')
  el.textContent = msg
  el.className = 'auth-msg ' + type
}

function translateAuthError(msg) {
  if (msg.includes('Invalid login'))           return 'Email ou senha incorretos.'
  if (msg.includes('Email not confirmed'))     return 'Confirme seu email antes de entrar.'
  if (msg.includes('User already registered')) return 'Email já cadastrado. Tente entrar.'
  if (msg.includes('Password should be'))      return 'A senha deve ter no mínimo 6 caracteres.'
  return msg
}

function showUserInfo(user) {
  const avatar = document.getElementById('user-avatar')
  const meta   = user.user_metadata
  if (meta && meta.avatar_url) {
    avatar.innerHTML = `<img src="${meta.avatar_url}" alt="avatar" />`
  } else {
    const initial = ((meta && meta.full_name) || user.email || '?')[0].toUpperCase()
    avatar.textContent = initial
  }
}

document.getElementById('btn-google-login').onclick = async () => {
  if (!sb) return showAuthMsg('Credenciais do Supabase não configuradas.', 'error')
  // Marca que um redirect OAuth vai acontecer (lido de volta ao retornar)
  sessionStorage.setItem('oauth_pending', '1')
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) {
    sessionStorage.removeItem('oauth_pending')
    showAuthMsg(error.message, 'error')
  }
}

document.getElementById('btn-auth-submit').onclick = async () => {
  if (!sb) return showAuthMsg('Credenciais do Supabase não configuradas.', 'error')
  const email = document.getElementById('auth-email').value.trim()
  const senha = document.getElementById('auth-senha').value
  const btn   = document.getElementById('btn-auth-submit')
  if (!email || !senha) return showAuthMsg('Preencha email e senha.', 'error')
  btn.disabled = true
  btn.textContent = 'Aguarde…'
  const result =
    currentTab === 'login'
      ? await sb.auth.signInWithPassword({ email, password: senha })
      : await sb.auth.signUp({ email, password: senha })
  btn.disabled = false
  btn.textContent = currentTab === 'login' ? 'Entrar' : 'Criar conta'
  if (result.error) showAuthMsg(translateAuthError(result.error.message), 'error')
  else if (currentTab === 'registro' && !(result.data && result.data.session))
    showAuthMsg('Conta criada! Verifique seu email para confirmar.', 'success')
}

document.getElementById('auth-email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-auth-submit').click()
})
document.getElementById('auth-senha').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-auth-submit').click()
})

if (!credenciaisOk) showAuthMsg('⚠️ Configure as variáveis de ambiente no arquivo .env.', 'error')

async function handleSession(session) {
  if (session) {
    sessionStorage.removeItem('oauth_pending')
    currentUser = session.user

    // Verifica admin no banco — não no frontend
    const { data: profile } = await sb
      .from('profiles')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()
    isAdmin = !!profile?.is_admin

    document.getElementById('loading-screen').style.display = 'none'
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('app').style.display = 'block'
    showUserInfo(currentUser)
    if (isAdmin) {
      document.getElementById('btn-pendentes').style.display = 'flex'
      document.getElementById('admin-badge-wrap').style.display = 'block'
      initAdminPanel()
    }
    if (!mapInitialized) {
      initMap()
      initSearch()
      makeDraggable(document.getElementById('painel'),       true)
      makeDraggable(document.getElementById('painel-admin'), false)
      mapInitialized = true
    }
  } else {
    currentUser = null
    isAdmin     = false
    // Só mostra login se NÃO estiver processando redirect OAuth
    if (!isOAuthRedirect) {
      document.getElementById('loading-screen').style.display = 'none'
      document.getElementById('login-screen').style.display = 'flex'
      document.getElementById('app').style.display = 'none'
    }
    // Se for redirect OAuth, mantém o loading até o SIGNED_IN disparar
  }
}

if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    handleSession(session)
  })
}

// Fallback: se OAuth travar por mais de 10s, desiste e mostra login
if (isOAuthRedirect) {
  setTimeout(() => {
    const loading = document.getElementById('loading-screen')
    if (loading && loading.style.display !== 'none') {
      sessionStorage.removeItem('oauth_pending')
      loading.style.display = 'none'
      document.getElementById('login-screen').style.display = 'flex'
    }
  }, 10000)
}

document.getElementById('btn-logout').onclick = () => { if (sb) sb.auth.signOut() }

// ══════════════════════════════════════
//  BUSCA
// ══════════════════════════════════════
function initSearch() {
  const panel    = document.getElementById('search-panel')
  const input    = document.getElementById('search-input')
  const results  = document.getElementById('search-results')
  const empty    = document.getElementById('search-empty')
  const btnOpen  = document.getElementById('btn-search-toggle')
  const btnClose = document.getElementById('btn-search-close')

  btnOpen.onclick = () => {
    panel.classList.toggle('open')
    if (panel.classList.contains('open')) {
      input.value = ''
      results.innerHTML = ''
      empty.style.display = 'none'
      setTimeout(() => input.focus(), 50)
    }
  }

  btnClose.onclick = () => {
    panel.classList.remove('open')
    input.value = ''
    results.innerHTML = ''
    empty.style.display = 'none'
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase()
    results.innerHTML = ''
    empty.style.display = 'none'
    if (!q) return

    const matches = Object.values(ctoData).filter(row => {
      return [row.endereco, row.bairro, row.area_cabo, row.sp, row.sec, row.status]
        .some(v => v && v.toString().toLowerCase().includes(q))
    })

    if (!matches.length) { empty.style.display = 'block'; return }

    const statusClass = { 'Ativa': 'ativa', 'Em manutenção': 'manutencao', 'Danificada': 'danificada', 'Desconhecida': 'desconhecida' }
    matches.slice(0, 30).forEach(row => {
      const li = document.createElement('li')
      const cls = statusClass[row.status] || 'desconhecida'
      const addr = [row.numero ? `Nº ${row.numero}` : '', row.endereco].filter(Boolean).join(' ')
      li.innerHTML = `
        <span class="sr-icon"><i class="ph-fill ph-battery-vertical-full" style="color:#39ff14"></i></span>
        <div class="sr-info">
          <div class="sr-endereco">${escHtml(addr || '—')}</div>
          <div class="sr-meta">${escHtml(row.bairro || '')}${row.area_cabo ? ' · ' + escHtml(row.area_cabo) : ''}${row.sp ? ' · SP ' + escHtml(row.sp) : ''}</div>
        </div>
        <span class="sr-status ${cls}">${escHtml(row.status)}</span>`
      li.onclick = () => {
        panel.classList.remove('open')
        input.value = ''
        results.innerHTML = ''
        map.flyTo([row.lat, row.lng], 19, { duration: 1 })
        setTimeout(() => { if (markers[row.id]) markers[row.id].openPopup() }, 1100)
      }
      results.appendChild(li)
    })
  })
}

// ══════════════════════════════════════
//  SWIPE PARA ABRIR/FECHAR PAINÉIS
// ══════════════════════════════════════
function makeDraggable(panelEl, fromLeft) {
  // fromLeft=true → painel vem da esquerda (#painel)
  // fromLeft=false → painel vem da direita (#painel-admin)
  const EDGE_ZONE  = 32   // px da borda da tela para iniciar arraste quando fechado
  const SNAP_RATIO = 0.35 // fração da largura para "snap" abrir/fechar

  let startX = 0, startY = 0, panelW = 0, tracking = false, moved = false

  function baseOffset() {
    // offset inicial em px conforme estado atual
    const open = panelEl.classList.contains('open')
    if (fromLeft)  return open ? 0 : -panelW
    else           return open ? 0 :  panelW
  }

  function setX(px) {
    panelEl.style.transition = 'none'
    panelEl.style.transform  = `translateX(${px}px)`
  }

  function commit(open) {
    panelEl.style.transition = ''
    panelEl.style.transform  = ''
    panelEl.classList.toggle('open', open)
  }

  document.addEventListener('touchstart', (e) => {
    panelW   = panelEl.offsetWidth
    startX   = e.touches[0].clientX
    startY   = e.touches[0].clientY
    tracking = false
    moved    = false

    const open = panelEl.classList.contains('open')
    if (fromLeft) {
      if (open  && startX < panelW + 10)               tracking = true
      if (!open && startX < EDGE_ZONE)                 tracking = true
    } else {
      if (open  && startX > window.innerWidth - panelW - 10) tracking = true
      if (!open && startX > window.innerWidth - EDGE_ZONE)   tracking = true
    }
  }, { passive: true })

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return
    const dx = e.touches[0].clientX - startX
    const dy = e.touches[0].clientY - startY

    if (!moved) {
      // Cancela se gesto for mais vertical que horizontal
      if (Math.abs(dy) > Math.abs(dx)) { tracking = false; return }
      moved = true
    }

    e.preventDefault()
    const base    = baseOffset()
    const raw     = base + dx
    const clamped = fromLeft
      ? Math.max(-panelW, Math.min(0, raw))
      : Math.max(0,       Math.min(panelW, raw))
    setX(clamped)
  }, { passive: false })

  document.addEventListener('touchend', (e) => {
    if (!tracking || !moved) { tracking = false; return }
    tracking = false

    const dx   = e.changedTouches[0].clientX - startX
    const open = panelEl.classList.contains('open')

    let shouldOpen
    if (fromLeft) {
      shouldOpen = open
        ? dx > -panelW * SNAP_RATIO   // estava aberto: fecha só se arrastou o suficiente
        : dx >  panelW * SNAP_RATIO   // estava fechado: abre se arrastou o suficiente
    } else {
      shouldOpen = open
        ? dx <  panelW * SNAP_RATIO
        : dx < -panelW * SNAP_RATIO
    }
    commit(shouldOpen)
  }, { passive: true })
}

// ══════════════════════════════════════
//  MAPA
// ══════════════════════════════════════
let map, clusterGroup, markers = {}, pendingLatLng = null, tempMarker = null, ctoData = {}
const activeFilters = new Set(['Ativa', 'Em manutenção', 'Danificada', 'Desconhecida'])

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([-23.5886, -46.6097], 15)
  const tileUrl = MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

  L.tileLayer(tileUrl, {
    attribution: MAPBOX_TOKEN
      ? '© <a href="https://www.mapbox.com/">Mapbox</a> © <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
      : '© OpenStreetMap contributors',
    tileSize:   MAPBOX_TOKEN ? 512 : 256,
    zoomOffset: MAPBOX_TOKEN ? -1  : 0,
    maxZoom: 22,
  }).addTo(map)
  L.control.zoom({ position: 'bottomright' }).addTo(map)

  // Cluster de markers
  clusterGroup = L.markerClusterGroup({
    iconCreateFunction: (cluster) => L.divIcon({
      html: `<div class="cto-cluster">${cluster.getChildCount()}</div>`,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    }),
    maxClusterRadius: 70,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    animate: true,
  })
  map.addLayer(clusterGroup)

  // Carrega comentários ao abrir popup
  map.on('popupopen', (e) => {
    const m = e.popup._source
    if (m && m._ctoId) loadComentarios(m._ctoId)
  })

  initFilters()

  map.on('click', (e) => {
    if (document.getElementById('modal').style.display === 'flex') return
    pendingLatLng = e.latlng
    placeTempMarker(e.latlng)
    openModal()
  })

  loadCtos()

  document.getElementById('btn-add').onclick = () => {
    pendingLatLng = null
    if (tempMarker) { tempMarker.remove(); tempMarker = null }
    openModal()
  }

  document.getElementById('btn-gps').onclick = () => {
    if (!navigator.geolocation) return alert('GPS não disponível.')
    document.getElementById('btn-gps').classList.add('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('btn-gps').classList.remove('loading')
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude)
        map.flyTo(ll, 17)
        pendingLatLng = ll
        placeTempMarker(ll)
        openModal()
      },
      () => {
        document.getElementById('btn-gps').classList.remove('loading')
        alert('Não foi possível obter localização.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  document.getElementById('btn-pendentes').onclick = () =>
    document.getElementById('painel-admin').classList.toggle('open')
  document.getElementById('btn-fechar-admin').onclick = () =>
    document.getElementById('painel-admin').classList.remove('open')
}

// ── Filtros de status ─────────────────────────────────────────
function initFilters() {
  document.querySelectorAll('.filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status
      if (activeFilters.has(status)) {
        activeFilters.delete(status)
        btn.classList.remove('active')
      } else {
        activeFilters.add(status)
        btn.classList.add('active')
      }
      applyFilters()
    })
  })
}

function applyFilters() {
  Object.entries(markers).forEach(([id, m]) => {
    const row = ctoData[id]
    if (!row || row.status_aprovacao === 'pendente') return
    const visible = activeFilters.has(row.status)
    if (visible) {
      if (!clusterGroup.hasLayer(m)) clusterGroup.addLayer(m)
    } else {
      if (clusterGroup.hasLayer(m)) clusterGroup.removeLayer(m)
    }
  })
}

// ── Alertas ──────────────────────────────────────────────────
let alertasCount = {}  // cto_id → número de alertas
let myAlertas    = new Set()  // cto_ids que o usuário atual reportou

async function loadAlertas() {
  const { data } = await sb.from('alertas').select('cto_id, user_id')
  if (!data) return
  alertasCount = {}
  myAlertas    = new Set()
  data.forEach(a => {
    alertasCount[a.cto_id] = (alertasCount[a.cto_id] || 0) + 1
    if (a.user_id === currentUser.id) myAlertas.add(a.cto_id)
  })
}

window.reportarAlerta = async (ctoId) => {
  const jaReportou = myAlertas.has(ctoId)
  if (jaReportou) {
    await sb.from('alertas').delete().eq('cto_id', ctoId).eq('user_id', currentUser.id)
    myAlertas.delete(ctoId)
    alertasCount[ctoId] = Math.max(0, (alertasCount[ctoId] || 1) - 1)
  } else {
    await sb.from('alertas').insert({ cto_id: ctoId, user_id: currentUser.id })
    myAlertas.add(ctoId)
    alertasCount[ctoId] = (alertasCount[ctoId] || 0) + 1
  }
  // Atualiza popup aberto sem recarregar o mapa
  if (markers[ctoId]) {
    markers[ctoId].setPopupContent(buildPopupHTML(ctoData[ctoId]))
    markers[ctoId].openPopup()
  }
  // Atualiza ícone se tem alertas
  refreshMarkerIcon(ctoId)
}

window.dispensarAlertas = async (ctoId) => {
  await sb.from('alertas').delete().eq('cto_id', ctoId)
  alertasCount[ctoId] = 0
  myAlertas.delete(ctoId)
  if (markers[ctoId]) {
    markers[ctoId].setPopupContent(buildPopupHTML(ctoData[ctoId]))
  }
  refreshMarkerIcon(ctoId)
}

function refreshMarkerIcon(ctoId) {
  if (!markers[ctoId] || !ctoData[ctoId]) return
  const row  = ctoData[ctoId]
  const icon = (alertasCount[ctoId] || 0) > 0 ? makeIconAlerta(row.status, row) : makeIcon(row.status, row)
  markers[ctoId].setIcon(icon)
  clusterGroup.refreshClusters(markers[ctoId])
}

async function loadCtos() {
  // Admin vê tudo; usuários comuns veem só aprovadas
  let query = sb.from(TABLE).select('*')
  if (!isAdmin) query = query.eq('status_aprovacao', 'aprovado')
  const { data, error } = await query
  if (error) { console.error(error.message); return }

  await loadAlertas()

  data.forEach((row) => {
    if (row.status_aprovacao === 'aprovado') addMarker(row)
    else if (isAdmin) addMarkerPendente(row)
  })
  if (isAdmin) updatePendenteCount()

  sb.channel('ctos-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload) => {
      const row = payload.new || payload.old

      if (payload.eventType === 'INSERT') {
        if (row.status_aprovacao === 'aprovado') {
          addMarker(row)
        } else if (isAdmin) {
          addMarkerPendente(row)
          upsertPendenteItem(row)
          updatePendenteCount()
        }
      } else if (payload.eventType === 'UPDATE') {
        removeMarker(row.id)
        removeListItem(row.id)
        removePendenteItem(row.id)
        removeTodasItem(row.id)
        removeAtividadeItem(row.id)
        if (row.status_aprovacao === 'aprovado') {
          addMarker(row)
        } else if (isAdmin && row.status_aprovacao === 'pendente') {
          addMarkerPendente(row)
        }
        updatePendenteCount()
      } else if (payload.eventType === 'DELETE') {
        removeMarker(row.id)
        removeListItem(row.id)
        removePendenteItem(row.id)
        removeTodasItem(row.id)
        removeAtividadeItem(row.id)
        updatePendenteCount()
      }
    })
    .subscribe()
}

// ── Ícones ────────────────────────────────────────────────────
function markerLabel(row) {
  const area = row?.area_cabo || ''
  const sp   = row?.sp        ? 'SP: ' + row.sp : ''
  return { area, sp }
}

function makeIcon(status, row) {
  const colors = { 'Ativa': '#22c55e', 'Em manutenção': '#f59e0b', 'Danificada': '#ef4444', 'Desconhecida': '#6b7280' }
  const c = colors[status] || '#6b7280'
  const { area, sp } = markerLabel(row)
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="color:${c};font-size:34px;line-height:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.8))">
        <i class="ph-fill ph-battery-vertical-full"></i>
      </div>
      <div style="background:#060f07;border:1.5px solid ${c};border-radius:4px;padding:2px 6px;margin-top:1px;text-align:center;white-space:nowrap;line-height:1.4;box-shadow:0 2px 6px rgba(0,0,0,0.6)">
        <div style="font-size:10px;font-weight:800;color:#fff;font-family:'Courier New',monospace;letter-spacing:0.01em">${area}</div>
        ${sp ? `<div style="font-size:9px;font-weight:600;color:#94a3b8;font-family:'Courier New',monospace">${sp}</div>` : ''}
      </div>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [72, 62], iconAnchor: [36, 62], popupAnchor: [0, -62] })
}

function makeIconAlerta(status, row) {
  const colors = { 'Ativa': '#22c55e', 'Em manutenção': '#f59e0b', 'Danificada': '#ef4444', 'Desconhecida': '#6b7280' }
  const c = colors[status] || '#6b7280'
  const { area, sp } = markerLabel(row)
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;position:relative;">
      <div style="color:${c};font-size:34px;line-height:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.8))">
        <i class="ph-fill ph-battery-vertical-full"></i>
      </div>
      <div style="position:absolute;top:-5px;right:-2px;background:#f97316;color:#fff;font-size:11px;font-weight:800;border-radius:50%;width:17px;height:17px;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 6px rgba(249,115,22,0.7)">!</div>
      <div style="background:#060f07;border:1.5px solid ${c};border-radius:4px;padding:2px 6px;margin-top:1px;text-align:center;white-space:nowrap;line-height:1.4;box-shadow:0 2px 6px rgba(0,0,0,0.6)">
        <div style="font-size:10px;font-weight:800;color:#fff;font-family:'Courier New',monospace;letter-spacing:0.01em">${area}</div>
        ${sp ? `<div style="font-size:9px;font-weight:600;color:#94a3b8;font-family:'Courier New',monospace">${sp}</div>` : ''}
      </div>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [72, 62], iconAnchor: [36, 62], popupAnchor: [0, -62] })
}

function makeIconPendente(row) {
  const { area, sp } = markerLabel(row)
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;opacity:0.8;">
      <div style="color:#f59e0b;font-size:34px;line-height:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.8))">
        <i class="ph-fill ph-battery-vertical-full"></i>
      </div>
      <div style="background:#060f07;border:1.5px solid #f59e0b;border-radius:4px;padding:2px 6px;margin-top:1px;text-align:center;white-space:nowrap;line-height:1.4;box-shadow:0 2px 6px rgba(0,0,0,0.6)">
        <div style="font-size:10px;font-weight:800;color:#fff;font-family:'Courier New',monospace">${area || '⏳'}</div>
        ${sp ? `<div style="font-size:9px;font-weight:600;color:#94a3b8;font-family:'Courier New',monospace">${sp}</div>` : ''}
      </div>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [72, 62], iconAnchor: [36, 62], popupAnchor: [0, -62] })
}

function addMarker(row) {
  ctoData[row.id] = row
  const icon = (alertasCount[row.id] || 0) > 0 ? makeIconAlerta(row.status, row) : makeIcon(row.status, row)
  const m = L.marker([row.lat, row.lng], { icon }).bindPopup(buildPopupHTML(row))
  m._ctoId = row.id
  markers[row.id] = m
  if (activeFilters.has(row.status)) clusterGroup.addLayer(m)
  upsertListItem(row)
  if (isAdmin) { upsertTodasItem(row); upsertAtividadeItem(row) }
}

function addMarkerPendente(row) {
  ctoData[row.id] = row
  const m = L.marker([row.lat, row.lng], { icon: makeIconPendente(row) }).bindPopup(buildPopupPendenteHTML(row))
  m._ctoId = row.id
  markers[row.id] = m
  clusterGroup.addLayer(m)
  upsertPendenteItem(row)
  if (isAdmin) { upsertTodasItem(row); upsertAtividadeItem(row) }
}

function removeMarker(id) {
  if (markers[id]) { clusterGroup.removeLayer(markers[id]); delete markers[id] }
  delete ctoData[id]
}

function placeTempMarker(ll) {
  if (tempMarker) tempMarker.remove()
  tempMarker = L.circleMarker(ll, {
    radius: 8, color: '#6366f1', fillColor: '#818cf8', fillOpacity: 0.7, weight: 2,
  }).addTo(map)
}

// ── Geocodificação + Autocomplete ─────────────────────────────
function setGeocodeMsg(msg, type) {
  const el = document.getElementById('geocode-msg')
  el.textContent = msg
  el.className   = 'geocode-msg ' + (type || '')
}

function hideAutocomplete() {
  const list = document.getElementById('autocomplete-list')
  if (list) { list.innerHTML = ''; list.style.display = 'none' }
}

function parseMapboxFeature(f) {
  const ctx    = f.context || []
  const parts  = f.place_name.split(',')
  const rua    = parts[0].trim()
  const bCtx   = ctx.find(c => c.id.startsWith('neighborhood') || c.id.startsWith('locality'))
  const cCtx   = ctx.find(c => c.id.startsWith('place'))
  const bairro = bCtx ? bCtx.text : (parts[1] ? parts[1].trim() : '')
  const cidade = cCtx ? cCtx.text : ''
  return { rua, bairro, cidade, lat: f.center[1], lng: f.center[0] }
}

function showAutocomplete(features) {
  const list = document.getElementById('autocomplete-list')
  list.innerHTML = ''
  if (!features.length) { list.style.display = 'none'; return }
  features.forEach((f) => {
    const { rua, bairro, cidade, lat, lng } = parseMapboxFeature(f)
    const item = document.createElement('div')
    item.className = 'autocomplete-item'
    item.innerHTML = `
      <div class="ac-rua">${escHtml(rua)}</div>
      <div class="ac-bairro">${escHtml([bairro, cidade].filter(Boolean).join(' · '))}</div>`
    item.onmousedown = (e) => {
      e.preventDefault()
      document.getElementById('f-endereco').value = rua
      document.getElementById('f-bairro').value   = bairro
      pendingLatLng = L.latLng(lat, lng)
      placeTempMarker(pendingLatLng)
      map.flyTo(pendingLatLng, 17)
      hideAutocomplete()
      setGeocodeMsg('✓ Rua encontrada — preencha o número para maior precisão', 'success')
      document.getElementById('f-numero').focus()
    }
    list.appendChild(item)
  })
  list.style.display = 'block'
}

let acTimer = null
document.getElementById('f-endereco').addEventListener('input', () => {
  clearTimeout(acTimer)
  const val = document.getElementById('f-endereco').value.trim()
  if (val.length < 4) return hideAutocomplete()
  acTimer = setTimeout(async () => {
    try {
      const bairroHint = document.getElementById('f-bairro').value.trim()
      const query = [val, bairroHint].filter(Boolean).join(', ')
      if (MAPBOX_TOKEN) {
        // proximity = centro de SP para priorizar a cidade sem restringir outros bairros
        const SP_CENTER = '-46.6333,-23.5505'
        const url  = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=BR&language=pt&types=address&autocomplete=true&limit=6&proximity=${SP_CENTER}`
        const res  = await fetch(url)
        const data = await res.json()
        showAutocomplete(data.features || [])
      } else {
        // fallback Nominatim
        const url  = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&countrycodes=br&addressdetails=1`
        const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
        const rows = await res.json()
        // adapta para formato esperado por showAutocomplete via Mapbox shape
        const features = rows.map(r => ({
          place_name: r.display_name,
          center: [parseFloat(r.lon), parseFloat(r.lat)],
          context: [],
        }))
        showAutocomplete(features)
      }
    } catch (_) {}
  }, 400)
})
document.getElementById('f-endereco').addEventListener('blur', () => setTimeout(hideAutocomplete, 150))

async function geocodeAddress(endereco, numero, bairro) {
  if (MAPBOX_TOKEN) {
    try {
      // Mapbox interpola numeração com precisão
      const query  = [numero ? `${numero} ${endereco}` : endereco, bairro, 'São Paulo'].filter(Boolean).join(', ')
      const url    = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=BR&language=pt&types=address&limit=1&proximity=-46.6333,-23.5505`
      const res   = await fetch(url)
      const data  = await res.json()
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center
        return { lat, lng }
      }
    } catch (_) {}
  }
  // Fallback Nominatim
  try {
    const endComNumero = [endereco, numero].filter(Boolean).join(', ')
    const query = [endComNumero, bairro].filter(Boolean).join(', ')
    const url   = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`
    const res   = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
    const data  = await res.json()
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch (_) {}
  return null
}

// ── Salvar CTO ────────────────────────────────────────────────
document.getElementById('form-cto').onsubmit = async (e) => {
  e.preventDefault()
  const btn      = document.getElementById('btn-salvar')
  const endereco = document.getElementById('f-endereco').value.trim()
  const numero   = document.getElementById('f-numero').value.trim()
  const bairro   = document.getElementById('f-bairro').value.trim()

  // Se tem número, refina a localização com o número
  if (pendingLatLng && numero) {
    const coords = await geocodeAddress(endereco, numero, bairro)
    if (coords) {
      pendingLatLng = L.latLng(coords.lat, coords.lng)
      placeTempMarker(pendingLatLng)
    }
  }

  if (!pendingLatLng) {
    if (!endereco && !bairro) return setGeocodeMsg('Selecione um endereço na lista ou clique no mapa.', 'error')
    btn.disabled = true; btn.textContent = 'Buscando…'
    setGeocodeMsg('Buscando localização…', '')
    const coords = await geocodeAddress(endereco, numero, bairro)
    if (!coords) {
      setGeocodeMsg('Endereço não encontrado. Selecione uma sugestão da lista.', 'error')
      btn.disabled = false; btn.textContent = 'Salvar'
      return
    }
    pendingLatLng = L.latLng(coords.lat, coords.lng)
    placeTempMarker(pendingLatLng)
    map.flyTo(pendingLatLng, 17)
  }

  btn.disabled = true; btn.textContent = 'Salvando…'

  const { error } = await sb.from(TABLE).insert({
    endereco:         endereco,
    numero:           numero,
    bairro:           bairro,
    area_cabo:        document.getElementById('f-area-cabo').value.trim(),
    sp:               document.getElementById('f-sp').value.trim(),
    sec:              document.getElementById('f-sec').value.trim(),
    status:           document.getElementById('f-status').value,
    lat:              pendingLatLng.lat,
    lng:              pendingLatLng.lng,
    status_aprovacao: isAdmin ? 'aprovado' : 'pendente',
    submetido_por:    currentUser?.email || '',
  })

  btn.disabled = false; btn.textContent = 'Salvar'

  if (error) {
    alert('Erro ao salvar: ' + error.message)
  } else {
    closeModal()
    if (!isAdmin) {
      // Mostra mensagem de análise para usuários comuns
      const hint = document.getElementById('hint')
      hint.textContent = '✅ CTO enviada para análise — aguarde aprovação do administrador'
      hint.style.color = '#4ade80'
      setTimeout(() => {
        hint.textContent = 'Toque no mapa ou use 📍 para registrar uma CTO'
        hint.style.color = ''
      }, 5000)
    }
  }
}

// ── Histórico ─────────────────────────────────────────────────
async function logHistorico(ctoId, acao, alteracoes = null) {
  if (!currentUser) return
  const meta = currentUser.user_metadata
  const userName = (meta && meta.full_name) || currentUser.email || 'Admin'
  await sb.from('historico_ctos').insert({
    cto_id: ctoId, user_id: currentUser.id, user_name: userName, acao, alteracoes,
  })
}

async function loadHistorico() {
  const container = document.getElementById('lista-historico')
  if (!container) return
  container.innerHTML = '<div class="usuarios-loading">Carregando…</div>'
  const { data, error } = await sb.from('historico_ctos')
    .select('id, cto_id, user_name, acao, alteracoes, created_at, ctos(area_cabo)')
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) { container.innerHTML = '<div class="usuarios-loading">Erro ao carregar.</div>'; return }
  if (!data.length) { container.innerHTML = '<div class="usuarios-loading">Nenhuma alteração registrada ainda.</div>'; return }
  const emojis = { editou: '✏️', aprovou: '✅', rejeitou: '❌', removeu: '🗑️', criou: '➕', 'mudou status': '🔄' }
  container.innerHTML = data.map(h => {
    const dt        = new Date(h.created_at).toLocaleString('pt-BR')
    const area      = h.ctos?.area_cabo || 'CTO'
    const firstName = (h.user_name || 'Admin').split(' ')[0]
    const emoji     = emojis[h.acao] || '📝'
    let detalhes = ''
    if (h.alteracoes) {
      const changed = Object.entries(h.alteracoes).map(([k, v]) => `${k}: ${escHtml(String(v))}`).join(' · ')
      detalhes = `<div class="hist-detalhes">${changed}</div>`
    }
    return `
      <div class="hist-item">
        <div class="hist-icon">${emoji}</div>
        <div class="hist-info">
          <div class="hist-title"><strong>${escHtml(firstName)}</strong> ${h.acao} <em>${escHtml(area)}</em></div>
          ${detalhes}
          <div class="hist-date">🕒 ${dt}</div>
        </div>
      </div>`
  }).join('')
}

// ── Aprovar / Rejeitar (admin) ────────────────────────────────
window.aprovarCto = async (id) => {
  await sb.from(TABLE).update({ status_aprovacao: 'aprovado' }).eq('id', id)
  logHistorico(id, 'aprovou')
  map.closePopup()
  document.getElementById('painel-admin').classList.remove('open')
}

window.rejeitarCto = async (id) => {
  if (!confirm('Rejeitar e remover esta CTO?')) return
  logHistorico(id, 'rejeitou')
  await sb.from(TABLE).delete().eq('id', id)
  map.closePopup()
}

window.deleteCto = async (id) => {
  if (!confirm('Remover esta CTO?')) return
  logHistorico(id, 'removeu')
  await sb.from(TABLE).delete().eq('id', id)
  map.closePopup()
}

window.changeStatus = async (id, newStatus) => {
  const oldStatus = ctoData[id]?.status
  await sb.from(TABLE).update({ status: newStatus }).eq('id', id)
  logHistorico(id, 'mudou status', { de: oldStatus, para: newStatus })
  map.closePopup()
}

window.focusMarker = (id) => {
  const m = markers[id]
  if (!m) return
  document.getElementById('painel').classList.remove('open')
  document.getElementById('painel-admin').classList.remove('open')
  clusterGroup.zoomToShowLayer(m, () => setTimeout(() => m.openPopup(), 300))
}

// ── Modal ─────────────────────────────────────────────────────
function openModal() {
  document.getElementById('f-endereco').value  = ''
  document.getElementById('f-numero').value    = ''
  document.getElementById('f-bairro').value    = ''
  document.getElementById('f-area-cabo').value = ''
  document.getElementById('f-sp').value        = ''
  document.getElementById('f-sec').value       = ''
  document.getElementById('f-status').value    = 'Ativa'
  setGeocodeMsg('', '')
  document.getElementById('modal').style.display = 'flex'
  document.getElementById('f-endereco').focus()
}

function closeModal() {
  document.getElementById('modal').style.display = 'none'
  pendingLatLng = null
  if (tempMarker) { tempMarker.remove(); tempMarker = null }
}

document.getElementById('btn-cancelar').onclick   = closeModal
document.getElementById('modal-backdrop').onclick = closeModal

// ── Popups ────────────────────────────────────────────────────
function buildPopupHTML(row) {
  const dt   = row.criado ? new Date(row.criado).toLocaleString('pt-BR') : '—'
  const endFull = [row.endereco, row.numero].filter(Boolean).join(', ')
  const enderecoHtml = endFull || row.bairro
    ? `<div class="popup-meta"><span class="popup-tag">📍</span> ${escHtml([endFull, row.bairro].filter(Boolean).join(' — '))}</div>` : ''
  const areaCaboHtml = row.area_cabo
    ? `<div class="popup-meta"><span class="popup-tag">ÁREA</span> ${escHtml(row.area_cabo)}</div>` : ''
  const spHtml  = row.sp  ? `<div class="popup-meta"><span class="popup-tag">SP</span> ${escHtml(row.sp)}</div>` : ''
  const secHtml = row.sec ? `<div class="popup-meta"><span class="popup-tag">SEC</span> ${escHtml(row.sec)}</div>` : ''

  const statusRow = isAdmin
    ? (() => {
        const opts = ['Ativa', 'Em manutenção', 'Danificada', 'Desconhecida']
          .map((s) => `<option ${s === row.status ? 'selected' : ''}>${s}</option>`).join('')
        return `<div class="popup-row">
          <label>Status:</label>
          <select onchange="changeStatus('${row.id}', this.value)">${opts}</select>
        </div>`
      })()
    : `<div class="popup-row">
        <label>Status:</label>
        <span class="popup-status-badge">${escHtml(row.status)}</span>
      </div>`

  const adminBtns = isAdmin
    ? `<div class="popup-admin-btns">
        <button class="popup-edit" onclick="editCto('${row.id}')">✏️ Editar</button>
        <button class="popup-del"  onclick="deleteCto('${row.id}')">🗑 Remover</button>
      </div>` : ''

  const mapsUrl    = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`
  const count      = alertasCount[row.id] || 0
  const jaReportou = myAlertas.has(row.id)

  const alertaBtn = isAdmin
    ? (count > 0
        ? `<button class="popup-alerta-dismiss" onclick="dispensarAlertas('${row.id}')">
             ⚠️ ${count} alerta${count > 1 ? 's' : ''} — Dispensar
           </button>`
        : '')
    : `<button class="popup-alerta-btn ${jaReportou ? 'reportado' : ''}" onclick="reportarAlerta('${row.id}')">
         ${jaReportou ? '✓ Ausência reportada' : '⚠️ Reportar ausência'}
       </button>`

  return `
    <div class="popup">
      <div class="popup-nome">${escHtml(row.area_cabo || 'CTO')}</div>
      ${enderecoHtml}${areaCaboHtml}${spHtml}${secHtml}
      ${statusRow}
      <div class="popup-coords">${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}</div>
      <div class="popup-date">${dt}</div>
      <a class="popup-maps-btn" href="${mapsUrl}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        Abrir rota no Google Maps
      </a>
      ${alertaBtn}
      ${adminBtns}
      <div class="popup-comments">
        <div class="popup-comments-title">💬 Comentários</div>
        <div id="cmt-${row.id}" class="cmt-list"><span class="cmt-empty">Carregando…</span></div>
        <div class="cmt-input-row">
          <input type="text" id="cmt-input-${row.id}" class="cmt-input" placeholder="Deixar observação…" maxlength="300" onkeydown="if(event.key==='Enter')addComentario('${row.id}')" />
          <button class="cmt-send" onclick="addComentario('${row.id}')">↩</button>
        </div>
      </div>
    </div>`
}

function buildPopupPendenteHTML(row) {
  const endFull = [row.endereco, row.numero].filter(Boolean).join(', ')
  const enderecoHtml = endFull || row.bairro
    ? `<div class="popup-meta"><span class="popup-tag">📍</span> ${escHtml([endFull, row.bairro].filter(Boolean).join(' — '))}</div>` : ''
  const areaCaboHtml = row.area_cabo ? `<div class="popup-meta"><span class="popup-tag">ÁREA</span> ${escHtml(row.area_cabo)}</div>` : ''
  const spHtml  = row.sp  ? `<div class="popup-meta"><span class="popup-tag">SP</span> ${escHtml(row.sp)}</div>` : ''
  const secHtml = row.sec ? `<div class="popup-meta"><span class="popup-tag">SEC</span> ${escHtml(row.sec)}</div>` : ''
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`

  return `
    <div class="popup">
      <div class="popup-pendente-tag">⏳ Aguardando aprovação</div>
      <div class="popup-nome">${escHtml(row.area_cabo || 'CTO')}</div>
      ${enderecoHtml}${areaCaboHtml}${spHtml}${secHtml}
      <div class="popup-meta" style="color:#94a3b8;font-size:11px">Por: ${escHtml(row.submetido_por || '—')}</div>
      <a class="popup-maps-btn" href="${mapsUrl}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        Abrir rota no Google Maps
      </a>
      <div class="popup-actions-admin">
        <button class="btn-aprovar" onclick="aprovarCto('${row.id}')">✓ Aprovar</button>
        <button class="btn-rejeitar" onclick="rejeitarCto('${row.id}')">✕ Rejeitar</button>
      </div>
    </div>`
}

// ── Comentários ───────────────────────────────────────────────
async function loadComentarios(ctoId) {
  const container = document.getElementById('cmt-' + ctoId)
  if (!container) return
  const { data, error } = await sb.from('comentarios')
    .select('id, user_name, texto, created_at, user_id')
    .eq('cto_id', ctoId)
    .order('created_at', { ascending: true })
  if (error) { container.innerHTML = '<span class="cmt-empty" style="color:#ef4444">Erro ao carregar</span>'; return }
  if (!data || !data.length) { container.innerHTML = '<span class="cmt-empty">Nenhum comentário ainda</span>'; return }
  container.innerHTML = data.map(c => {
    const firstName = (c.user_name || 'Anônimo').split(' ')[0]
    const dt = new Date(c.created_at).toLocaleDateString('pt-BR')
    const canDel = isAdmin || c.user_id === currentUser?.id
    return `
      <div class="cmt-item">
        <div class="cmt-header">
          <span class="cmt-author">${escHtml(firstName)}</span>
          <span class="cmt-date">${dt}</span>
          ${canDel ? `<button class="cmt-del" onclick="deleteComentario('${ctoId}','${c.id}')">✕</button>` : ''}
        </div>
        <div class="cmt-text">${escHtml(c.texto)}</div>
      </div>`
  }).join('')
}

window.addComentario = async (ctoId) => {
  const input = document.getElementById('cmt-input-' + ctoId)
  if (!input) return
  const texto = input.value.trim()
  if (!texto) return
  const meta = currentUser?.user_metadata
  const fullName = (meta && meta.full_name) || currentUser?.email || 'Usuário'
  const { error } = await sb.from('comentarios').insert({
    cto_id: ctoId,
    user_id: currentUser?.id,
    user_name: fullName,
    texto,
  })
  if (!error) { input.value = ''; loadComentarios(ctoId) }
}

window.deleteComentario = async (ctoId, comentarioId) => {
  await sb.from('comentarios').delete().eq('id', comentarioId)
  loadComentarios(ctoId)
}

// ── Lista lateral agrupada por área ───────────────────────────
const openGroups = new Set()   // grupos expandidos
const STATUS_COLORS = { 'Ativa': '#22c55e', 'Em manutenção': '#f59e0b', 'Danificada': '#ef4444', 'Desconhecida': '#6b7280' }

function upsertListItem(_row) { renderGroupedList() }
function removeListItem(_id)  { renderGroupedList() }

function renderGroupedList() {
  const lista = document.getElementById('lista-ctos')

  // Agrupa por area_cabo
  const groups = {}
  Object.values(ctoData)
    .filter(r => r.status_aprovacao === 'aprovado' || isAdmin)
    .forEach(r => {
      const key = r.area_cabo || '—'
      if (!groups[key]) groups[key] = []
      groups[key].push(r)
    })

  // Ordena grupos alfabeticamente
  const sortedKeys = Object.keys(groups).sort()

  lista.innerHTML = ''

  sortedKeys.forEach(key => {
    const rows = groups[key].sort((a, b) => (a.sp || '').localeCompare(b.sp || ''))
    const isOpen = openGroups.has(key)

    // Status geral do grupo (pior status)
    const priority = ['Danificada', 'Em manutenção', 'Desconhecida', 'Ativa']
    const worstStatus = priority.find(s => rows.some(r => r.status === s)) || 'Desconhecida'
    const groupColor  = STATUS_COLORS[worstStatus] || '#6b7280'
    const hasAlerta   = rows.some(r => (alertasCount[r.id] || 0) > 0)

    const li = document.createElement('li')
    li.className = 'group-li'
    li.id = 'grp-' + CSS.escape(key)

    const childEls = rows.map(r => {
      const c    = STATUS_COLORS[r.status] || '#6b7280'
      const info = [r.sp ? 'SP: ' + r.sp : '', r.sec ? 'SEC: ' + r.sec : '', r.status].filter(Boolean).join(' · ')
      const alerta = (alertasCount[r.id] || 0) > 0 ? ' <span class="grp-alerta-dot">!</span>' : ''
      const addr   = r.endereco ? `<small class="grp-addr">${escHtml([r.numero, r.endereco].filter(Boolean).join(' '))}</small>` : ''
      const el = document.createElement('li')
      el.className = 'group-child'
      el.innerHTML = `
        <span class="dot" style="background:${c};flex-shrink:0"></span>
        <div class="list-info">
          <small>${escHtml(info)}${alerta}</small>
          ${addr}
        </div>
        <span class="list-arrow">›</span>`
      el.addEventListener('click', () => focusMarker(r.id))
      return el
    })
    const children = childEls

    const header = document.createElement('div')
    header.className = 'group-header'
    header.innerHTML = `
      <span class="group-chevron">${isOpen ? '▾' : '▸'}</span>
      <span class="dot" style="background:${groupColor};flex-shrink:0"></span>
      <div class="list-info">
        <strong>${escHtml(key)}${hasAlerta ? ' <span class="grp-alerta-dot">!</span>' : ''}</strong>
        <small>${rows.length} CTO${rows.length !== 1 ? 's' : ''}</small>
      </div>`
    header.addEventListener('click', () => {
      if (openGroups.has(key)) openGroups.delete(key)
      else openGroups.add(key)
      renderGroupedList()
    })

    const ul = document.createElement('ul')
    ul.className = 'group-children'
    ul.style.display = isOpen ? 'block' : 'none'
    children.forEach(el => ul.appendChild(el))

    li.appendChild(header)
    li.appendChild(ul)
    lista.appendChild(li)
  })

  updateCount()
}

function updateCount() {
  const n   = Object.values(ctoData).filter(r => r.status_aprovacao === 'aprovado' || isAdmin).length
  const txt = n + ' CTO' + (n !== 1 ? 's' : '')
  document.getElementById('cto-count').textContent       = txt
  document.getElementById('cto-count-badge').textContent = txt
}

// ── Painel admin (pendentes) ──────────────────────────────────
function upsertPendenteItem(row) {
  let li = document.getElementById('pli-' + row.id)
  if (!li) { li = document.createElement('li'); li.id = 'pli-' + row.id; document.getElementById('lista-pendentes').appendChild(li) }
  li.innerHTML = `
    <div class="list-item pendente-item" onclick="focusMarker('${row.id}')">
      <span class="dot" style="background:#f59e0b"></span>
      <div class="list-info">
        <strong>${escHtml(row.area_cabo || 'CTO')}</strong>
        <small>${escHtml(row.submetido_por || '—')}${row.bairro ? ' · ' + escHtml(row.bairro) : ''}</small>
      </div>
      <div class="pendente-btns">
        <button class="btn-aprovar-sm" onclick="event.stopPropagation();aprovarCto('${row.id}')">✓</button>
        <button class="btn-rejeitar-sm" onclick="event.stopPropagation();rejeitarCto('${row.id}')">✕</button>
      </div>
    </div>`
}

function removePendenteItem(id) {
  const li = document.getElementById('pli-' + id)
  if (li) li.remove()
  updatePendenteCount()
}

function updatePendenteCount() {
  const n = document.querySelectorAll('#lista-pendentes li').length
  const badge    = document.getElementById('pendentes-badge')
  const tabBadge = document.getElementById('pendentes-tab-count')
  badge.textContent = n
  badge.style.display = n > 0 ? 'flex' : 'none'
  if (tabBadge) tabBadge.textContent = n
}

// ── Painel admin: abas ────────────────────────────────────────
window.switchAdminTab = function (tab) {
  const ids = ['lista-pendentes','lista-todas','lista-atividade','lista-usuarios','lista-dashboard','lista-historico']
  ids.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.style.display = el.id === 'lista-' + tab ? 'block' : 'none'
  })
  document.querySelectorAll('.admin-tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === tab)
  )
  if (tab === 'usuarios')  loadUsuarios()
  if (tab === 'dashboard') loadDashboard()
  if (tab === 'historico') loadHistorico()
}

async function loadUsuarios() {
  const container = document.getElementById('lista-usuarios')
  container.innerHTML = '<div class="usuarios-loading">Carregando…</div>'

  const { data: perfis, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false })
  if (error) { container.innerHTML = '<div class="usuarios-loading">Erro ao carregar.</div>'; return }

  const ctoCounts = {}
  Object.values(ctoData).forEach(row => {
    if (row.submetido_por) ctoCounts[row.submetido_por] = (ctoCounts[row.submetido_por] || 0) + 1
  })

  container.innerHTML = ''

  if (!perfis.length) {
    container.innerHTML = '<div class="usuarios-loading">Nenhum usuário encontrado.</div>'
    return
  }

  // Campo de busca
  const searchWrap = document.createElement('div')
  searchWrap.className = 'usuario-search-wrap'
  searchWrap.innerHTML = `<input type="text" class="usuario-search-input" id="usuario-search" placeholder="🔍 Buscar por nome ou email…" />`
  container.appendChild(searchWrap)

  const cardsWrap = document.createElement('div')
  cardsWrap.id = 'usuario-cards'
  container.appendChild(cardsWrap)

  function renderCards(filtro) {
    const q = (filtro || '').toLowerCase()
    cardsWrap.innerHTML = ''
    const filtrados = perfis.filter(p => {
      const nome  = (p.full_name || '').toLowerCase()
      const email = (p.email || '').toLowerCase()
      return !q || nome.includes(q) || email.includes(q)
    })
    if (!filtrados.length) {
      cardsWrap.innerHTML = '<div class="usuarios-loading">Nenhum resultado.</div>'
      return
    }
    filtrados.forEach(p => {
      const nome    = p.full_name || p.email || 'Sem nome'
      const inicial = nome[0].toUpperCase()
      const dt      = p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—'
      const ctos    = ctoCounts[p.email] || 0
      const isAdminUser = !!p.is_admin
      const card = document.createElement('div')
      card.className = 'usuario-card'
      card.innerHTML = `
        <div class="usuario-avatar">
          ${p.avatar_url
            ? `<img src="${p.avatar_url}" alt="avatar" />`
            : `<span>${escHtml(inicial)}</span>`}
        </div>
        <div class="usuario-info">
          <div class="usuario-nome">${escHtml(nome)} ${isAdminUser ? '<span class="usuario-admin-badge">admin</span>' : ''}</div>
          <div class="usuario-email">${escHtml(p.email || '—')}</div>
          <div class="usuario-meta">📅 ${dt} · 📦 ${ctos} CTO${ctos !== 1 ? 's' : ''}</div>
        </div>`
      cardsWrap.appendChild(card)
    })
  }

  renderCards('')
  document.getElementById('usuario-search').addEventListener('input', (e) => renderCards(e.target.value))
}

// ── Lista "Todas as CTOs" (admin) ─────────────────────────────
function upsertTodasItem(row) {
  let li = document.getElementById('tai-' + row.id)
  if (!li) {
    li = document.createElement('li')
    li.id = 'tai-' + row.id
    document.getElementById('lista-todas').appendChild(li)
  }
  const colors = {
    'Ativa': '#22c55e', 'Em manutenção': '#f59e0b',
    'Danificada': '#ef4444', 'Desconhecida': '#6b7280',
  }
  const c = colors[row.status] || '#6b7280'
  const pendTag = row.status_aprovacao === 'pendente'
    ? '<span class="todas-badge">⏳</span>' : ''
  li.innerHTML = `
    <div class="list-item todas-item">
      <span class="dot" style="background:${c};flex-shrink:0"></span>
      <div class="list-info" onclick="focusMarker('${row.id}');document.getElementById('painel-admin').classList.remove('open')" style="cursor:pointer">
        <strong>${escHtml(row.area_cabo || 'CTO')} ${pendTag}</strong>
        <small>${escHtml(row.status)}${row.bairro ? ' · ' + escHtml(row.bairro) : ''}${row.endereco ? ' · ' + escHtml(row.endereco) : ''}</small>
      </div>
      <div class="todas-actions">
        <button class="todas-btn edit-btn" title="Editar"  onclick="editCto('${row.id}')">✏️</button>
        <button class="todas-btn del-btn"  title="Remover" onclick="deleteCtoAdmin('${row.id}')">🗑</button>
      </div>
    </div>`
}

function removeTodasItem(id) {
  const li = document.getElementById('tai-' + id)
  if (li) li.remove()
}

// ── Lista de Inserções (admin) ────────────────────────────────
function upsertAtividadeItem(row) {
  const lista = document.getElementById('lista-atividade')
  if (!lista) return   // guard: index.html antigo sem o elemento
  let li = document.getElementById('ati-' + row.id)
  if (!li) {
    li = document.createElement('li')
    li.id = 'ati-' + row.id
    li.dataset.criado = row.criado || ''
    // Insere na posição correta (mais recente no topo)
    const items = Array.from(lista.children)
    const after = items.find(el => (el.dataset.criado || '') < (row.criado || ''))
    lista.insertBefore(li, after || null)
  }
  const dt      = row.criado ? new Date(row.criado).toLocaleString('pt-BR') : '—'
  const usuario = row.submetido_por || 'Desconhecido'
  const inicial = usuario[0].toUpperCase()
  const isPend  = row.status_aprovacao === 'pendente'
  const badgeCls = isPend ? 'ativ-badge pendente' : 'ativ-badge aprovado'
  const badgeTxt = isPend ? '⏳ Pendente' : '✓ Aprovado'

  li.innerHTML = `
    <div class="ativ-item" onclick="focusMarker('${row.id}');switchAdminTab('atividade')">
      <div class="ativ-avatar">${escHtml(inicial)}</div>
      <div class="ativ-info">
        <strong>${escHtml(row.area_cabo || 'CTO')}</strong>
        <small>${escHtml(usuario)}</small>
        <small class="ativ-date">🕒 ${dt}</small>
      </div>
      <span class="${badgeCls}">${badgeTxt}</span>
    </div>`
}

function removeAtividadeItem(id) {
  const li = document.getElementById('ati-' + id)
  if (li) li.remove()
}

// ── Editar CTO (admin) ────────────────────────────────────────
window.editCto = function (id) {
  const row = ctoData[id]
  if (!row) return
  document.getElementById('edit-id').value                  = id
  document.getElementById('edit-endereco').value            = row.endereco  || ''
  document.getElementById('edit-bairro').value              = row.bairro    || ''
  document.getElementById('edit-numero').value              = row.numero    || ''
  document.getElementById('edit-area-cabo').value           = row.area_cabo || ''
  document.getElementById('edit-sp').value                  = row.sp        || ''
  document.getElementById('edit-sec').value                 = row.sec       || ''
  document.getElementById('edit-status').value              = row.status    || 'Ativa'
  document.getElementById('edit-status-aprovacao').value    = row.status_aprovacao || 'pendente'
  document.getElementById('edit-msg').textContent           = ''
  document.getElementById('edit-msg').className             = 'geocode-msg'
  document.getElementById('modal-edit').style.display      = 'flex'
}

function initAdminPanel() {
  const cancelar  = document.getElementById('btn-edit-cancelar')
  const backdrop  = document.getElementById('modal-edit-backdrop')
  const salvar    = document.getElementById('btn-edit-salvar')
  if (!cancelar || !backdrop || !salvar) return   // index.html antigo — ignora

  cancelar.onclick = () => {
    document.getElementById('modal-edit').style.display = 'none'
  }
  backdrop.onclick = () => {
    document.getElementById('modal-edit').style.display = 'none'
  }
  salvar.onclick = async () => {
    const id  = document.getElementById('edit-id').value
    const btn = salvar
    btn.disabled = true; btn.textContent = 'Salvando…'
    const { error } = await sb.from(TABLE).update({
      endereco:         document.getElementById('edit-endereco').value.trim(),
      numero:           document.getElementById('edit-numero').value.trim(),
      bairro:           document.getElementById('edit-bairro').value.trim(),
      area_cabo:        document.getElementById('edit-area-cabo').value.trim(),
      sp:               document.getElementById('edit-sp').value.trim(),
      sec:              document.getElementById('edit-sec').value.trim(),
      status:           document.getElementById('edit-status').value,
      status_aprovacao: document.getElementById('edit-status-aprovacao').value,
    }).eq('id', id)
    btn.disabled = false; btn.textContent = 'Salvar'
    if (error) {
      const msg = document.getElementById('edit-msg')
      msg.textContent = 'Erro: ' + error.message
      msg.className   = 'geocode-msg error'
    } else {
      logHistorico(id, 'editou', {
        endereco: document.getElementById('edit-endereco').value.trim(),
        status:   document.getElementById('edit-status').value,
        aprovacao: document.getElementById('edit-status-aprovacao').value,
      })
      document.getElementById('modal-edit').style.display = 'none'
    }
  }
}

window.deleteCtoAdmin = async (id) => {
  if (!confirm('Remover esta CTO permanentemente?')) return
  logHistorico(id, 'removeu')
  await sb.from(TABLE).delete().eq('id', id)
}

// ── Painel lateral ────────────────────────────────────────────
document.getElementById('btn-lista').onclick = () => document.getElementById('painel').classList.toggle('open')
document.getElementById('btn-fechar-painel').onclick = () => document.getElementById('painel').classList.remove('open')

// ── Dashboard Admin ───────────────────────────────────────────
async function loadDashboard() {
  const container = document.getElementById('lista-dashboard')
  if (!container) return
  container.innerHTML = '<div class="dash-loading">Carregando dados…</div>'

  // Busca dados em paralelo
  const [
    { data: todasCtos },
    { data: alertasData },
    { data: usuariosData },
  ] = await Promise.all([
    sb.from('ctos').select('id, status, status_aprovacao, area_cabo, bairro, criado, submetido_por'),
    sb.from('alertas').select('id, cto_id'),
    sb.from('profiles').select('id, created_at'),
  ])

  const ctos      = todasCtos   || []
  const alertas   = alertasData || []
  const usuarios  = usuariosData || []

  // ─── Métricas gerais ───────────────────────────────────────
  const total       = ctos.length
  const aprovadas   = ctos.filter(c => c.status_aprovacao === 'aprovado').length
  const pendentes   = ctos.filter(c => c.status_aprovacao === 'pendente').length
  const ativas      = ctos.filter(c => c.status === 'Ativa').length
  const manutencao  = ctos.filter(c => c.status === 'Em manutenção').length
  const danificadas = ctos.filter(c => c.status === 'Danificada').length
  const desconhecidas = ctos.filter(c => c.status === 'Desconhecida').length
  const comAlerta   = new Set(alertas.map(a => a.cto_id)).size
  const totalUsuarios = usuarios.length

  // ─── Top 6 áreas por quantidade de CTOs ───────────────────
  const areaCounts = {}
  ctos.forEach(c => {
    const area = c.area_cabo || 'Sem área'
    areaCounts[area] = (areaCounts[area] || 0) + 1
  })
  const topAreas = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const maxArea = topAreas[0]?.[1] || 1

  // ─── Gráfico temporal: últimos 6 meses ────────────────────
  const now    = new Date()
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      count: 0,
    })
  }
  ctos.forEach(c => {
    if (!c.criado) return
    const key = c.criado.substring(0, 7)
    const m   = months.find(m => m.key === key)
    if (m) m.count++
  })
  const maxMonthCount = Math.max(...months.map(m => m.count), 1)

  // ─── Atividade recente (últimas 5 inserções) ───────────────
  const recentes = [...ctos]
    .filter(c => c.criado)
    .sort((a, b) => b.criado.localeCompare(a.criado))
    .slice(0, 5)

  // ─── Render ────────────────────────────────────────────────
  container.innerHTML = `
    <!-- Cards de métricas -->
    <div class="dash-cards">
      <div class="dash-card">
        <div class="dash-card-icon" style="background:rgba(57,255,20,.12)">📦</div>
        <div class="dash-card-body">
          <div class="dash-card-value">${total}</div>
          <div class="dash-card-label">Total de CTOs</div>
        </div>
        <div class="dash-card-bar" style="width:100%;background:#39ff1433"></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon" style="background:rgba(34,197,94,.15)">✅</div>
        <div class="dash-card-body">
          <div class="dash-card-value" style="color:#22c55e">${ativas}</div>
          <div class="dash-card-label">CTOs Ativas</div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon" style="background:rgba(245,158,11,.15)">⏳</div>
        <div class="dash-card-body">
          <div class="dash-card-value" style="color:#f59e0b">${pendentes}</div>
          <div class="dash-card-label">Pendentes de aprovação</div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon" style="background:rgba(239,68,68,.15)">🔔</div>
        <div class="dash-card-body">
          <div class="dash-card-value" style="color:#ef4444">${comAlerta}</div>
          <div class="dash-card-label">CTOs com alertas</div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon" style="background:rgba(147,51,234,.15)">👥</div>
        <div class="dash-card-body">
          <div class="dash-card-value" style="color:#a855f7">${totalUsuarios}</div>
          <div class="dash-card-label">Usuários cadastrados</div>
        </div>
      </div>
    </div>

    <!-- Status por tipo e gráfico de áreas -->
    <div class="dash-row">
      <!-- Gráfico por área -->
      <div class="dash-panel dash-chart-panel">
        <div class="dash-panel-title">📊 CTOs por Área</div>
        <div class="dash-chart">
          ${topAreas.map(([area, count]) => {
            const pct = Math.round((count / maxArea) * 100)
            return `
            <div class="dash-bar-row">
              <div class="dash-bar-label" title="${escHtml(area)}">${escHtml(area)}</div>
              <div class="dash-bar-track">
                <div class="dash-bar-fill" style="width:${pct}%"></div>
              </div>
              <div class="dash-bar-count">${count}</div>
            </div>`
          }).join('')}
          ${topAreas.length === 0 ? '<div style="color:#6b7280;text-align:center;padding:20px">Sem dados</div>' : ''}
        </div>
      </div>

      <!-- Status breakdown -->
      <div class="dash-panel dash-status-panel">
        <div class="dash-panel-title">🎯 Distribuição por Status</div>
        <div class="dash-status-list">
          ${[
            ['Ativa',          ativas,       '#22c55e', '🟢'],
            ['Em manutenção',  manutencao,   '#f59e0b', '🟡'],
            ['Danificada',     danificadas,  '#ef4444', '🔴'],
            ['Desconhecida',   desconhecidas,'#6b7280', '⚪'],
            ['Aprovadas',      aprovadas,    '#39ff14', '✅'],
          ].map(([label, val, color, emoji]) => `
            <div class="dash-status-row">
              <span class="dash-status-dot" style="background:${color}"></span>
              <span class="dash-status-label">${label}</span>
              <div class="dash-status-bar-track">
                <div class="dash-status-bar-fill" style="width:${total > 0 ? Math.round((val/total)*100) : 0}%;background:${color}"></div>
              </div>
              <span class="dash-status-count" style="color:${color}">${val}</span>
            </div>`).join('')}
        </div>

        <!-- System health -->
        <div class="dash-panel-title" style="margin-top:16px">⚡ Sistema</div>
        <div class="dash-health-list">
          <div class="dash-health-row">
            <span class="dash-health-dot ok"></span>
            <span>Supabase</span>
            <span class="dash-health-status ok">Online</span>
          </div>
          <div class="dash-health-row">
            <span class="dash-health-dot ok"></span>
            <span>Realtime</span>
            <span class="dash-health-status ok">Ativo</span>
          </div>
          <div class="dash-health-row">
            <span class="dash-health-dot ok"></span>
            <span>Mapa</span>
            <span class="dash-health-status ok">Carregado</span>
          </div>
          <div class="dash-health-row">
            <span class="dash-health-dot ${comAlerta > 0 ? 'warn' : 'ok'}"></span>
            <span>Alertas abertos</span>
            <span class="dash-health-status ${comAlerta > 0 ? 'warn' : 'ok'}">${comAlerta > 0 ? comAlerta + ' alerta' + (comAlerta !== 1 ? 's' : '') : 'Nenhum'}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Gráfico temporal -->
    <div class="dash-panel">
      <div class="dash-panel-title">📈 CTOs cadastradas por mês</div>
      <div class="dash-timeline">
        ${months.map(m => {
          const pct = Math.round((m.count / maxMonthCount) * 100)
          return `
          <div class="dash-tl-col">
            <div class="dash-tl-bar-wrap">
              <div class="dash-tl-count">${m.count > 0 ? m.count : ''}</div>
              <div class="dash-tl-bar" style="height:${pct}%"></div>
            </div>
            <div class="dash-tl-label">${m.label}</div>
          </div>`
        }).join('')}
      </div>
    </div>

    <!-- Atividade recente -->
    <div class="dash-panel">
      <div class="dash-panel-title">🕒 Inserções Recentes</div>
      <div class="dash-activity">
        ${recentes.map(c => {
          const dt = c.criado ? new Date(c.criado).toLocaleString('pt-BR') : '—'
          const isPend = c.status_aprovacao === 'pendente'
          const statusColor = { 'Ativa': '#22c55e', 'Em manutenção': '#f59e0b', 'Danificada': '#ef4444', 'Desconhecida': '#6b7280' }[c.status] || '#6b7280'
          const inicial = (c.submetido_por || '?')[0].toUpperCase()
          return `
          <div class="dash-activity-row" onclick="focusMarker('${c.id}');document.getElementById('painel-admin').classList.remove('open')" style="cursor:pointer">
            <div class="dash-activity-avatar">${escHtml(inicial)}</div>
            <div class="dash-activity-info">
              <div class="dash-activity-title">${escHtml(c.area_cabo || 'CTO')}</div>
              <div class="dash-activity-sub">${escHtml(c.submetido_por || 'Desconhecido')}${c.bairro ? ' · ' + escHtml(c.bairro) : ''}</div>
            </div>
            <div class="dash-activity-right">
              <span class="dash-activity-badge" style="background:${statusColor}22;color:${statusColor}">${escHtml(c.status)}</span>
              <div class="dash-activity-date">${dt}</div>
            </div>
          </div>`
        }).join('')}
        ${recentes.length === 0 ? '<div style="color:#6b7280;text-align:center;padding:16px">Nenhuma inserção ainda</div>' : ''}
      </div>
    </div>
  `
}

// ── Utilitários ───────────────────────────────────────────────
function escHtml(s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
