import { useEffect, useState } from 'react'

const API = 'http://localhost:3000/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}`, 'Content-Type': 'application/json' })
const PERMISOS = [
  ['ventas.ver', 'Consultar y registrar ventas'],
  ['inventario.ver', 'Consultar inventario'],
  ['inventario.crear', 'Crear productos'],
  ['inventario.editar', 'Editar productos y stock'],
  ['inventario.solo_propios', 'Restringir: solo editar los productos que él mismo creó'],
  ['inventario.transferir', 'Transferir stock de su sucursal hacia otra sucursal'],
  ['compras.ver', 'Ver el módulo de Compras'],
  ['compras.crear', 'Registrar compras a proveedores (suma stock y actualiza costo)'],
  ['precios.compra.ver', 'Ver el precio de compra (costo) de los productos'],
  ['cotizaciones.ver', 'Consultar cotizaciones / notas de venta'],
  ['cotizaciones.crear', 'Crear cotizaciones / notas de venta'],
  ['cotizaciones.eliminar', 'Eliminar cotizaciones'],
  ['caja.ver', 'Consultar caja'],
  ['reportes.ver', 'Consultar reportes'],
  ['clientes.ver', 'Consultar clientes'],
  ['proveedores.ver', 'Consultar proveedores']
]
const PLANTILLAS_ROL = [
  { nombre: 'Cajero', permisos: ['ventas.ver', 'inventario.ver', 'cotizaciones.ver', 'cotizaciones.crear', 'caja.ver'] },
  { nombre: 'Vendedor de calle', permisos: ['inventario.ver', 'cotizaciones.ver', 'cotizaciones.crear'] },
  { nombre: 'Encargado de almacén', permisos: ['inventario.ver', 'inventario.crear', 'inventario.editar', 'inventario.transferir', 'compras.ver', 'compras.crear', 'precios.compra.ver', 'proveedores.ver'] }
]
const usuarioVacio = { nombre: '', usuario: '', password: '', rol_id: '', sucursal_id: '', permisos: [] }
const sucursalVacia = { nombre: '', direccion: '', telefono: '' }
const rolVacio = { nombre: '', permisos: [] }

function ChecklistPermisos({ permisos, onChange }) {
  return <fieldset className="admin-permissions">
    <legend>Permisos</legend>
    {PERMISOS.map(([id, etiqueta]) => <label key={id}>
      <input type="checkbox" checked={permisos.includes(id)} onChange={(e) => onChange(e.target.checked ? [...permisos, id] : permisos.filter((p) => p !== id))} />
      {etiqueta}
    </label>)}
  </fieldset>
}

function Administracion({ usuario, vistaInicial = 'sucursales' }) {
  const [sucursales, setSucursales] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [roles, setRoles] = useState([])
  const [tab, setTab] = useState(vistaInicial)
  const [formulario, setFormulario] = useState(sucursalVacia)
  const [usuarioNuevo, setUsuarioNuevo] = useState(usuarioVacio)
  const [rolNuevo, setRolNuevo] = useState(rolVacio)
  const [mostrarRolRapido, setMostrarRolRapido] = useState(false)
  const [nombreRolRapido, setNombreRolRapido] = useState('')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(true)

  const [editandoSucursalId, setEditandoSucursalId] = useState(null)
  const [formularioSucursal, setFormularioSucursal] = useState(sucursalVacia)
  const [editandoUsuarioId, setEditandoUsuarioId] = useState(null)
  const [formularioUsuario, setFormularioUsuario] = useState(usuarioVacio)
  const [editandoRolId, setEditandoRolId] = useState(null)
  const [formularioRol, setFormularioRol] = useState(rolVacio)

  const cargar = async () => {
    setCargando(true)
    setError('')
    try {
      const [sucursalesRespuesta, usuariosRespuesta, rolesRespuesta] = await Promise.all([
        fetch(`${API}/sucursales`, { headers: auth() }),
        fetch(`${API}/usuarios`, { headers: auth() }),
        fetch(`${API}/roles`, { headers: auth() })
      ])
      const sucursalesDatos = await sucursalesRespuesta.json()
      const usuariosDatos = await usuariosRespuesta.json()
      const rolesDatos = await rolesRespuesta.json()
      if (!sucursalesRespuesta.ok || !sucursalesDatos.ok) throw new Error(sucursalesDatos.mensaje || 'No se pudieron cargar sucursales')
      if (!usuariosRespuesta.ok || !usuariosDatos.ok) throw new Error(usuariosDatos.mensaje || 'No se pudieron cargar usuarios')
      if (!rolesRespuesta.ok || !rolesDatos.ok) throw new Error(rolesDatos.mensaje || 'No se pudieron cargar roles')
      setSucursales(sucursalesDatos.sucursales || [])
      setUsuarios(usuariosDatos.usuarios || [])
      setRoles(rolesDatos.roles || [])
    } catch (err) {
      setError(err.message || 'No se pudo cargar la administración')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const avisar = (texto) => { setMensaje(texto); setError('') }
  const fallar = (texto) => { setError(texto); setMensaje('') }

  // ---------- SUCURSALES ----------
  const crearSucursal = async (evento) => {
    evento.preventDefault()
    const respuesta = await fetch(`${API}/sucursales`, { method: 'POST', headers: auth(), body: JSON.stringify(formulario) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo crear la sucursal')
    setFormulario(sucursalVacia)
    avisar('Sucursal creada correctamente')
    cargar()
  }

  const empezarEdicionSucursal = (item) => {
    setEditandoSucursalId(item.id)
    setFormularioSucursal({ nombre: item.nombre, direccion: item.direccion || '', telefono: item.telefono || '' })
  }

  const guardarEdicionSucursal = async (evento) => {
    evento.preventDefault()
    const respuesta = await fetch(`${API}/sucursales/${editandoSucursalId}`, { method: 'PUT', headers: auth(), body: JSON.stringify(formularioSucursal) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo actualizar la sucursal')
    setEditandoSucursalId(null)
    avisar('Sucursal actualizada correctamente')
    cargar()
  }

  // ---------- USUARIOS ----------
  const permisosDelRol = (rolId) => roles.find((r) => String(r.id) === String(rolId))?.permisos || []

  const crearUsuario = async (evento) => {
    evento.preventDefault()
    const respuesta = await fetch(`${API}/usuarios`, { method: 'POST', headers: auth(), body: JSON.stringify(usuarioNuevo) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo crear el usuario')
    setUsuarioNuevo(usuarioVacio)
    avisar('Usuario creado correctamente')
    cargar()
  }

  const empezarEdicionUsuario = (item) => {
    setEditandoUsuarioId(item.id)
    setFormularioUsuario({ nombre: item.nombre, usuario: item.usuario, password: '', rol_id: item.rol_id || '', sucursal_id: item.sucursal_id || '', permisos: item.permisos || [] })
  }

  const guardarEdicionUsuario = async (evento) => {
    evento.preventDefault()
    const respuesta = await fetch(`${API}/usuarios/${editandoUsuarioId}`, { method: 'PUT', headers: auth(), body: JSON.stringify(formularioUsuario) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo actualizar el usuario')
    setEditandoUsuarioId(null)
    avisar('Usuario actualizado correctamente')
    cargar()
  }

  // ---------- ROLES ----------
  const crearRol = async (evento) => {
    evento.preventDefault()
    const respuesta = await fetch(`${API}/roles`, { method: 'POST', headers: auth(), body: JSON.stringify(rolNuevo) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo crear el rol')
    setRolNuevo(rolVacio)
    avisar('Rol creado correctamente')
    cargar()
  }

  const empezarEdicionRol = (rol) => {
    setEditandoRolId(rol.id)
    setFormularioRol({ nombre: rol.nombre, permisos: rol.permisos || [] })
  }

  const guardarEdicionRol = async (evento) => {
    evento.preventDefault()
    const respuesta = await fetch(`${API}/roles/${editandoRolId}`, { method: 'PUT', headers: auth(), body: JSON.stringify(formularioRol) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo actualizar el rol')
    setEditandoRolId(null)
    avisar('Rol actualizado correctamente')
    cargar()
  }

  const eliminarRol = async (rol) => {
    if (!window.confirm(`¿Eliminar el rol "${rol.nombre}"? Esto solo funciona si ningún usuario lo tiene asignado.`)) return
    const respuesta = await fetch(`${API}/roles/${rol.id}`, { method: 'DELETE', headers: auth() })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo eliminar el rol')
    avisar('Rol eliminado correctamente')
    cargar()
  }

  // Crea un rol desde el formulario de usuario, con los permisos que ya marcaste ahí.
  const crearRolRapido = async () => {
    if (!nombreRolRapido.trim()) return fallar('Escribe el nombre del rol')
    const respuesta = await fetch(`${API}/roles`, { method: 'POST', headers: auth(), body: JSON.stringify({ nombre: nombreRolRapido, permisos: usuarioNuevo.permisos }) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo crear el rol')
    const rolesDatos = await (await fetch(`${API}/roles`, { headers: auth() })).json()
    if (rolesDatos.ok) setRoles(rolesDatos.roles || [])
    setUsuarioNuevo((anterior) => ({ ...anterior, rol_id: datos.rol.id }))
    setMostrarRolRapido(false)
    setNombreRolRapido('')
    avisar(`Rol "${datos.rol.nombre}" creado y seleccionado`)
  }

  // ---------- COMÚN ----------
  const cambiarEstado = async (tipo, id, activo) => {
    const respuesta = await fetch(`${API}/${tipo}/${id}/estado`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ activo: !activo }) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return fallar(datos.mensaje || 'No se pudo cambiar el estado')
    avisar(activo ? 'Se desactivó correctamente. El historial de ventas y caja se conserva intacto.' : 'Se reactivó correctamente')
    cargar()
  }

  if (cargando) return <div className="admin-message">Cargando administración...</div>

  return <section className="admin-page">
    <div className="admin-heading">
      <div><span className="ventas-kicker">CONTROL CENTRAL</span><h2>Sucursales, usuarios y roles</h2><p>Administra el alcance de cada persona sin mezclar inventarios ni operaciones.</p></div>
      <span className="admin-owner">{usuario.rol || 'Administrador'}</span>
    </div>
    {error && <div className="ventas-error">{error}</div>}{mensaje && <div className="ventas-success">{mensaje}</div>}
    <div className="admin-tabs">
      <button className={tab === 'sucursales' ? 'active' : ''} onClick={() => setTab('sucursales')}>Sucursales <b>{sucursales.length}</b></button>
      <button className={tab === 'usuarios' ? 'active' : ''} onClick={() => setTab('usuarios')}>Usuarios <b>{usuarios.length}</b></button>
      <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles <b>{roles.length}</b></button>
    </div>

    {tab === 'sucursales' && <div className="admin-grid">
      <form className="admin-card" onSubmit={crearSucursal}>
        <span className="ventas-kicker">NUEVA SUCURSAL</span><h3>Crear tienda</h3>
        <label>Nombre<input value={formulario.nombre} onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} required /></label>
        <label>Dirección<input value={formulario.direccion} onChange={(e) => setFormulario({ ...formulario, direccion: e.target.value })} /></label>
        <label>Teléfono<input value={formulario.telefono} onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })} /></label>
        <button className="ventas-button ventas-button-primary">Crear sucursal</button>
      </form>
      <div className="admin-card">
        <span className="ventas-kicker">RED DE TIENDAS</span><h3>Sucursales registradas</h3>
        <div className="admin-list">
          {sucursales.map((item) => editandoSucursalId === item.id
            ? <form className="admin-edit-row" key={item.id} onSubmit={guardarEdicionSucursal}>
                <input value={formularioSucursal.nombre} onChange={(e) => setFormularioSucursal({ ...formularioSucursal, nombre: e.target.value })} placeholder="Nombre" required />
                <input value={formularioSucursal.direccion} onChange={(e) => setFormularioSucursal({ ...formularioSucursal, direccion: e.target.value })} placeholder="Dirección" />
                <input value={formularioSucursal.telefono} onChange={(e) => setFormularioSucursal({ ...formularioSucursal, telefono: e.target.value })} placeholder="Teléfono" />
                <button className="ventas-button ventas-button-primary" type="submit">Guardar</button>
                <button className="secondary-button" type="button" onClick={() => setEditandoSucursalId(null)}>Cancelar</button>
              </form>
            : <div className="admin-list-item admin-list-item-column" key={item.id}>
                <div className="admin-item-row">
                  <div><strong>{item.nombre}</strong><small>{item.direccion || 'Sin dirección'} · {item.unidades_stock} unidades en stock</small></div>
                  <div className="admin-item-actions">
                    <button className="secondary-button" onClick={() => empezarEdicionSucursal(item)}>Editar</button>
                    <button className="admin-state" onClick={() => cambiarEstado('sucursales', item.id, item.activo)}>{item.activo ? 'Activa · Eliminar' : 'Inactiva · Reactivar'}</button>
                  </div>
                </div>
                <div className="admin-sucursal-usuarios">
                  <small><strong>{item.usuarios}</strong> usuario(s) asignado(s):</small>
                  {usuarios.filter((u) => Number(u.sucursal_id) === Number(item.id)).map((u) => <span className="admin-badge" key={u.id}>{u.nombre} · {u.rol}{!u.activo && ' (inactivo)'}</span>)}
                  {!usuarios.some((u) => Number(u.sucursal_id) === Number(item.id)) && <small>Ningún usuario asignado todavía.</small>}
                </div>
              </div>)}
        </div>
      </div>
    </div>}

    {tab === 'usuarios' && <div className="admin-grid">
      <form className="admin-card" onSubmit={crearUsuario}>
        <span className="ventas-kicker">NUEVO ACCESO</span><h3>Crear usuario</h3>
        <label>Nombre completo<input value={usuarioNuevo.nombre} onChange={(e) => setUsuarioNuevo({ ...usuarioNuevo, nombre: e.target.value })} required /></label>
        <label>Usuario<input value={usuarioNuevo.usuario} onChange={(e) => setUsuarioNuevo({ ...usuarioNuevo, usuario: e.target.value })} required /></label>
        <label>Contraseña<input type="password" value={usuarioNuevo.password} onChange={(e) => setUsuarioNuevo({ ...usuarioNuevo, password: e.target.value })} required /></label>
        <label>Rol<select value={usuarioNuevo.rol_id} onChange={(e) => setUsuarioNuevo({ ...usuarioNuevo, rol_id: e.target.value, permisos: permisosDelRol(e.target.value) })} required>
          <option value="">Selecciona un rol</option>
          {roles.map((rol) => <option key={rol.id} value={rol.id}>{rol.nombre}</option>)}
        </select></label>
        <button type="button" className="secondary-button" style={{ width: 'fit-content' }} onClick={() => setMostrarRolRapido(!mostrarRolRapido)}>{mostrarRolRapido ? 'Cancelar' : '+ Crear rol nuevo'}</button>
        {mostrarRolRapido && <div className="admin-edit-block">
          <small>Marca abajo los permisos que tendrá este rol y ponle nombre, o usa una plantilla:</small>
          <div className="admin-item-actions" style={{ flexWrap: 'wrap' }}>{PLANTILLAS_ROL.map((plantilla) => <button key={plantilla.nombre} type="button" className="secondary-button" onClick={() => { setNombreRolRapido(plantilla.nombre); setUsuarioNuevo({ ...usuarioNuevo, permisos: plantilla.permisos }) }}>{plantilla.nombre}</button>)}</div>
          <input placeholder="Nombre del rol (ej. Vendedor)" value={nombreRolRapido} onChange={(e) => setNombreRolRapido(e.target.value)} />
          <button type="button" className="ventas-button ventas-button-primary" onClick={crearRolRapido}>Crear rol con los permisos marcados</button>
        </div>}
        <label>Sucursal<select value={usuarioNuevo.sucursal_id} onChange={(e) => setUsuarioNuevo({ ...usuarioNuevo, sucursal_id: e.target.value })} required>
          <option value="">Selecciona una sucursal</option>
          {sucursales.map((sucursal) => <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>)}
        </select></label>
        <small>Al elegir el rol se cargan sus permisos por defecto; puedes ajustarlos abajo para este usuario en particular.</small>
        <ChecklistPermisos permisos={usuarioNuevo.permisos} onChange={(permisos) => setUsuarioNuevo({ ...usuarioNuevo, permisos })} />
        <button className="ventas-button ventas-button-primary">Crear usuario</button>
      </form>
      <div className="admin-card">
        <span className="ventas-kicker">ACCESOS</span><h3>Usuarios registrados</h3>
        <div className="admin-list">
          {usuarios.map((item) => editandoUsuarioId === item.id
            ? <form className="admin-edit-block" key={item.id} onSubmit={guardarEdicionUsuario}>
                <input value={formularioUsuario.nombre} onChange={(e) => setFormularioUsuario({ ...formularioUsuario, nombre: e.target.value })} placeholder="Nombre completo" required />
                <input type="password" value={formularioUsuario.password} onChange={(e) => setFormularioUsuario({ ...formularioUsuario, password: e.target.value })} placeholder="Nueva contraseña (opcional)" />
                <select value={formularioUsuario.rol_id} onChange={(e) => setFormularioUsuario({ ...formularioUsuario, rol_id: e.target.value })} required>
                  <option value="">Selecciona un rol</option>
                  {roles.map((rol) => <option key={rol.id} value={rol.id}>{rol.nombre}</option>)}
                </select>
                <select value={formularioUsuario.sucursal_id} onChange={(e) => setFormularioUsuario({ ...formularioUsuario, sucursal_id: e.target.value })} required>
                  <option value="">Selecciona una sucursal</option>
                  {sucursales.map((sucursal) => <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>)}
                </select>
                <ChecklistPermisos permisos={formularioUsuario.permisos} onChange={(permisos) => setFormularioUsuario({ ...formularioUsuario, permisos })} />
                <div className="admin-item-actions">
                  <button className="ventas-button ventas-button-primary" type="submit">Guardar</button>
                  <button className="secondary-button" type="button" onClick={() => setEditandoUsuarioId(null)}>Cancelar</button>
                </div>
              </form>
            : <div className="admin-list-item" key={item.id}>
                <div><strong>{item.nombre}</strong><small>{item.usuario} · {item.rol || 'Sin rol'} · {item.sucursal_nombre || 'Sin sucursal'}</small></div>
                <div className="admin-item-actions">
                  <button className="secondary-button" onClick={() => empezarEdicionUsuario(item)}>Editar</button>
                  <button className="admin-state" onClick={() => cambiarEstado('usuarios', item.id, item.activo)}>{item.activo ? 'Activo · Eliminar' : 'Inactivo · Reactivar'}</button>
                </div>
              </div>)}
        </div>
      </div>
    </div>}

    {tab === 'roles' && <div className="admin-grid">
      <form className="admin-card" onSubmit={editandoRolId ? guardarEdicionRol : crearRol}>
        <span className="ventas-kicker">{editandoRolId ? 'EDITAR ROL' : 'NUEVO ROL'}</span><h3>{editandoRolId ? 'Editar permisos del rol' : 'Crear rol'}</h3>
        {editandoRolId
          ? <>
              <label>Nombre<input value={formularioRol.nombre} onChange={(e) => setFormularioRol({ ...formularioRol, nombre: e.target.value })} required /></label>
              <ChecklistPermisos permisos={formularioRol.permisos} onChange={(permisos) => setFormularioRol({ ...formularioRol, permisos })} />
              <div className="admin-item-actions">
                <button className="ventas-button ventas-button-primary" type="submit">Guardar rol</button>
                <button className="secondary-button" type="button" onClick={() => setEditandoRolId(null)}>Cancelar</button>
              </div>
            </>
          : <>
              <small>Plantillas rápidas (puedes ajustar los permisos después):</small>
              <div className="admin-item-actions" style={{ flexWrap: 'wrap' }}>{PLANTILLAS_ROL.map((plantilla) => <button key={plantilla.nombre} type="button" className="secondary-button" onClick={() => setRolNuevo({ nombre: plantilla.nombre, permisos: plantilla.permisos })}>{plantilla.nombre}</button>)}</div>
              <label>Nombre<input value={rolNuevo.nombre} onChange={(e) => setRolNuevo({ ...rolNuevo, nombre: e.target.value })} placeholder="Ej. Vendedor de calle" required /></label>
              <ChecklistPermisos permisos={rolNuevo.permisos} onChange={(permisos) => setRolNuevo({ ...rolNuevo, permisos })} />
              <button className="ventas-button ventas-button-primary">Crear rol</button>
            </>}
        <small>Estos permisos son la plantilla por defecto: cada usuario nuevo de este rol los recibe automáticamente, pero luego se pueden ajustar uno por uno sin afectar al resto.</small>
      </form>
      <div className="admin-card">
        <span className="ventas-kicker">ROLES</span><h3>Roles del sistema</h3>
        <div className="admin-list">
          {roles.map((rol) => <div className="admin-list-item" key={rol.id}>
            <div><strong>{rol.nombre}</strong><small>{(rol.permisos || []).length} permiso(s) por defecto</small></div>
            <div className="admin-item-actions">
              <button className="secondary-button" onClick={() => empezarEdicionRol(rol)}>Editar</button>
              {![1, '1'].includes(rol.id) && <button className="secondary-button" onClick={() => eliminarRol(rol)}>Eliminar</button>}
            </div>
          </div>)}
        </div>
      </div>
    </div>}
  </section>
}

export default Administracion
