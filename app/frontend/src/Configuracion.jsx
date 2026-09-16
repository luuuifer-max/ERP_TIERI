import { useEffect, useState } from 'react'

const API = 'http://localhost:3000/api'

function Configuracion({ usuario }) {
  const [formulario, setFormulario] = useState({ nombre: 'Tienda Tieri', direccion: '', telefono: '', logo: '' })
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const cargar = async () => {
      try {
        const respuesta = await fetch(`${API}/configuracion?sucursal_id=${usuario.sucursal_id}`)
        const datos = await respuesta.json()
        if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo cargar la configuración')
        setFormulario((anterior) => ({ ...anterior, ...datos.configuracion }))
      } catch (err) {
        setError(err.message || 'No se pudo cargar la configuración')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [usuario.sucursal_id])

  const cambiar = (campo, valor) => setFormulario((anterior) => ({ ...anterior, [campo]: valor }))

  const seleccionarLogo = (evento) => {
    const archivo = evento.target.files?.[0]
    if (!archivo) return
    if (archivo.size > 800000) {
      setError('El logo debe pesar menos de 800 KB')
      return
    }
    const lector = new FileReader()
    lector.onload = () => cambiar('logo', lector.result)
    lector.readAsDataURL(archivo)
  }

  const guardar = async (evento) => {
    evento.preventDefault()
    setGuardando(true)
    setError('')
    setMensaje('')
    try {
      const respuesta = await fetch(`${API}/configuracion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formulario, sucursal_id: usuario.sucursal_id })
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo guardar')
      setMensaje('Configuración guardada correctamente')
    } catch (err) {
      setError(err.message || 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="configuracion-message">Cargando configuración...</div>

  return (
    <section className="configuracion-page">
      <div className="configuracion-heading"><div><span className="ventas-kicker">ADMINISTRACIÓN</span><h2>Datos del minimarket</h2><p>Estos datos aparecerán en los tickets y reportes.</p></div></div>
      {error && <div className="ventas-error">{error}</div>}
      {mensaje && <div className="ventas-success">{mensaje}</div>}
      <form className="configuracion-card" onSubmit={guardar}>
        <div className="configuracion-grid">
          <label>Nombre del negocio<input value={formulario.nombre} onChange={(e) => cambiar('nombre', e.target.value)} required /></label>
          <label>Teléfono<input value={formulario.telefono} onChange={(e) => cambiar('telefono', e.target.value)} /></label>
          <label className="configuracion-full">Dirección<input value={formulario.direccion} onChange={(e) => cambiar('direccion', e.target.value)} /></label>
          <label className="configuracion-full">Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={seleccionarLogo} /></label>
        </div>
        {formulario.logo && <img className="configuracion-logo" src={formulario.logo} alt="Logo del negocio" />}
        <button className="ventas-button ventas-button-primary" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar cambios'}</button>
      </form>
    </section>
  )
}

export default Configuracion
