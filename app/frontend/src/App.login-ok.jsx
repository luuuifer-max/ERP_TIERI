import { useState } from 'react'

function App() {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  const iniciarSesion = async (e) => {
    e.preventDefault()

    setError('')
    setMensaje('')
    setCargando(true)

    try {
      const respuesta = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          usuario,
          password
        })
      })

      const datos = await respuesta.json()

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.mensaje || 'No se pudo iniciar sesión')
      }

      localStorage.setItem('tieri_token', datos.token)
      localStorage.setItem('tieri_usuario', JSON.stringify(datos.usuario))

      setMensaje(
        `Bienvenido, ${datos.usuario.nombre}. Sesión iniciada correctamente.`
      )

      setPassword('')
    } catch (err) {
      setError(err.message || 'Error de conexión con el servidor')
    } finally {
      setCargando(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand">
          <div className="brand-icon">T</div>

          <h1>Tienda Tieri</h1>

          <p>ERP MINIMARKET BOLIVIA</p>
        </div>

        <div className="login-title">
          <h2>Iniciar sesión</h2>
          <span>Ingresa para administrar tu negocio</span>
        </div>

        <form onSubmit={iniciarSesion}>
          <label htmlFor="usuario">Usuario</label>

          <input
            id="usuario"
            type="text"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="Ingresa tu usuario"
            autoComplete="username"
            required
          />

          <label htmlFor="password">Contraseña</label>

          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Ingresa tu contraseña"
            autoComplete="current-password"
            required
          />

          <button type="submit" disabled={cargando}>
            {cargando ? 'Ingresando...' : 'INGRESAR'}
          </button>
        </form>

        {error && (
          <div className="message error">
            {error}
          </div>
        )}

        {mensaje && (
          <div className="message success">
            {mensaje}
          </div>
        )}

        <footer>
          <span>© Tienda Tieri</span>
          <span>ERP para minimarkets</span>
        </footer>
      </section>
    </main>
  )
}

export default App
