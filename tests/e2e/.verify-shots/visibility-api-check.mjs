// 一次性 API 级验证：门户可见范围过滤（ALL/ROLE/USER/超管/无权限）
const BASE = 'http://127.0.0.1:48080/admin-api'
const ts = Date.now()
const results = []
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra })
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`)
}

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', 'tenant-id': '1' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return res.json()
}

async function login(username, password) {
  const r = await api('POST', '/system/auth/login', null, { username, password })
  if (r.code !== 0) throw new Error(`login ${username} failed: ${JSON.stringify(r)}`)
  return r.data.accessToken
}

const created = { portals: [], users: [], roles: [], grants: [] }

async function main() {
  const admin = await login('admin', 'admin123')

  // 1. 建三个链接门户：A=所有人 B=指定用户(admin id=1) C=指定角色(common)
  const mk = (code, name, scope, ids) => ({
    name, code, description: '走查可见性', type: 1, linkType: 0, linkUrl: '/system/user',
    content: '', isDefault: false, enabled: true, visibleScope: scope, visibleIds: ids
  })
  const codeA = `vis_a_${ts}`, codeB = `vis_b_${ts}`, codeC = `vis_c_${ts}`
  const [rA, rB, rC] = await Promise.all([
    api('POST', '/infra/portal/create', admin, mk(codeA, '可见性A所有人', 0, undefined)),
    api('POST', '/infra/portal/create', admin, mk(codeB, '可见性B指定用户', 2, '1')),
    api('POST', '/infra/portal/create', admin, mk(codeC, '可见性C指定角色', 1, 'common'))
  ])
  for (const [r, c] of [[rA, codeA], [rB, codeB], [rC, codeC]]) {
    if (r.code !== 0) throw new Error(`create ${c}: ${JSON.stringify(r)}`)
    created.portals.push(r.data)
  }
  const [idA, idB, idC] = created.portals
  await Promise.all(created.portals.map((id) => api('POST', '/infra/portal/publish', admin, { id, publishRemark: '可见性走查' })))

  // 2. 建临时角色（授 portal:run 菜单 2548）与两个临时用户
  const roleCode = `vis_role_${ts}`
  const rr = await api('POST', '/system/role/create', admin, { name: '可见性走查角色', code: roleCode, sort: 99, status: 0 })
  if (rr.code !== 0) throw new Error('create role: ' + JSON.stringify(rr))
  created.roles.push(rr.data)
  const roleId = rr.data
  // 本项目启用新授权引擎（grant-enabled=true），权限判定走 sys_grant，
  // 必须给角色建一条 infra:portal:run(resourceId=1539) 的 ALLOW/VIEW 授权
  const PORTAL_RUN_RESOURCE_ID = 1539
  const grant = await api('POST', '/system/grant/create', admin, {
    subjectType: 'ROLE',
    subjectRefId: roleId,
    resourceId: PORTAL_RUN_RESOURCE_ID,
    action: 'VIEW',
    effect: 'ALLOW'
  })
  if (grant.code !== 0) throw new Error('grant portal:run: ' + JSON.stringify(grant))
  created.grants.push(grant.data)

  const u1 = `visu1${ts}`, u2 = `visu2${ts}`
  const r1 = await api('POST', '/system/user/create', admin, { username: u1, nickname: '可见性走查用户1', password: 'Walk123456' })
  const r2 = await api('POST', '/system/user/create', admin, { username: u2, nickname: '可见性走查用户2', password: 'Walk123456' })
  if (r1.code !== 0 || r2.code !== 0) throw new Error('create user: ' + JSON.stringify([r1, r2]))
  created.users.push(r1.data, r2.data)
  const userId1 = r1.data
  const aur = await api('POST', '/system/permission/assign-user-role', admin, { userId: userId1, roleIds: [roleId] })
  if (aur.code !== 0) throw new Error('assign-user-role: ' + JSON.stringify(aur))

  // 3. 超管可见全部三个
  const adminList = await api('GET', '/infra/portal/runtime/list', admin)
  const adminCodes = (adminList.data || []).map((p) => p.code)
  check('超管 runtime/list 含 A/B/C',
    [codeA, codeB, codeC].every((c) => adminCodes.includes(c)), adminCodes.join(','))

  // 4. 有 run 权限的普通用户：仅 A（所有人）可见
  const t1 = await login(u1, 'Walk123456')
  const list1 = await api('GET', '/infra/portal/runtime/list', t1)
  const codes1 = (list1.data || []).map((p) => p.code)
  check('普通用户仅见所有人门户 A', codes1.includes(codeA) && !codes1.includes(codeB) && !codes1.includes(codeC), codes1.join(','))

  // 5. 不可见门户 runtime/{code} 返回 null
  const rb = await api('GET', `/infra/portal/runtime/${codeB}`, t1)
  check('普通用户访问不可见门户 B runtime/{code} 返回 null', rb.code === 0 && rb.data === null, JSON.stringify(rb).slice(0, 120))

  // 6. 把 B 的可见用户改成 u1、C 的可见角色改成走查角色 → 均可见
  const updB = await api('PUT', '/infra/portal/update', admin, { ...mk(codeB, '可见性B指定用户', 2, String(userId1)), id: idB })
  const updC = await api('PUT', '/infra/portal/update', admin, { ...mk(codeC, '可见性C指定角色', 1, roleCode), id: idC })
  if (updB.code !== 0 || updC.code !== 0) throw new Error('update: ' + JSON.stringify([updB, updC]))
  const list2 = await api('GET', '/infra/portal/runtime/list', t1)
  const codes2 = (list2.data || []).map((p) => p.code)
  check('调整可见名单后 u1 可见 A/B/C',
    [codeA, codeB, codeC].every((c) => codes2.includes(c)), codes2.join(','))
  // 更新后 B 仍保持已发布状态（链接门户编辑即时生效不改状态）
  const getB = await api('GET', '/infra/portal/get?id=' + idB, admin)
  check('链接门户编辑后状态保持已发布', getB.data?.status === 1, 'status=' + getB.data?.status)
  const rb2 = await api('GET', `/infra/portal/runtime/${codeB}`, t1)
  check('可见后 runtime/{code} 返回内容且带链接信息',
    rb2.data?.type === 1 && rb2.data?.linkUrl === '/system/user', JSON.stringify(rb2.data || {}).slice(0, 150))

  // 7. 无 run 权限用户：list 空、home null
  const t2 = await login(u2, 'Walk123456')
  const list3 = await api('GET', '/infra/portal/runtime/list', t2)
  check('无 portal:run 权限用户 list 返回空', list3.code === 0 && Array.isArray(list3.data) && list3.data.length === 0, JSON.stringify(list3).slice(0, 120))
  const home3 = await api('GET', '/infra/portal/runtime/home', t2)
  check('无 portal:run 权限用户 home 返回 null', home3.code === 0 && home3.data === null, JSON.stringify(home3).slice(0, 120))
}

async function cleanup() {
  try {
    const admin = await login('admin', 'admin123')
    for (const id of created.portals) await api('DELETE', '/infra/portal/delete?id=' + id, admin)
    for (const id of created.grants) await api('DELETE', '/system/grant/delete?id=' + id, admin)
    for (const id of created.users) await api('DELETE', '/system/user/delete?id=' + id, admin)
    for (const id of created.roles) await api('DELETE', '/system/role/delete?id=' + id, admin)
    console.log('CLEANUP_OK', JSON.stringify(created))
  } catch (e) {
    console.log('CLEANUP_FAIL', e.message, JSON.stringify(created))
  }
}

main()
  .then(() => cleanup())
  .catch(async (e) => {
    console.error('ERROR', e.message)
    await cleanup()
    process.exit(1)
  })
