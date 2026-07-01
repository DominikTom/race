import { useEffect, useState } from 'react'
import { adminListUsers, adminCreateUser, adminDeleteUser, type AdminUser } from '../lib/admin'

/** Panel admina: lista użytkowników + dodawanie/usuwanie (przez Edge Function). */
export default function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [makeAdmin, setMakeAdmin] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const { users } = await adminListUsers()
      setUsers(users)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => {
    reload()
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    setBusy(true)
    try {
      await adminCreateUser(email, pass, makeAdmin)
      setMsg(`Dodano użytkownika ${email}`)
      setEmail('')
      setPass('')
      setMakeAdmin(false)
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(u: AdminUser) {
    if (!confirm(`Usunąć użytkownika ${u.email}?`)) return
    setErr(null)
    try {
      await adminDeleteUser(u.id)
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="admin-panel">
      <h2>Panel admina</h2>
      <form className="admin-add" onSubmit={add}>
        <input type="email" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="text" placeholder="hasło" value={pass} onChange={(e) => setPass(e.target.value)} />
        <label className="row checkbox">
          <input type="checkbox" checked={makeAdmin} onChange={(e) => setMakeAdmin(e.target.checked)} />
          admin
        </label>
        <button type="submit" disabled={busy || !email || pass.length < 6}>Dodaj użytkownika</button>
      </form>
      {err && <p className="err small">{err}</p>}
      {msg && <p className="small" style={{ color: 'var(--best)' }}>{msg}</p>}

      <ul className="user-list">
        {users.map((u) => (
          <li key={u.id}>
            <span>{u.email}</span>
            {u.is_admin && <span className="db-tag">admin</span>}
            <span className="muted small last-seen">
              {u.last_sign_in_at ? 'ost. logowanie ' + u.last_sign_in_at.slice(0, 10) : 'nigdy'}
            </span>
            <button className="del" onClick={() => remove(u)}>usuń</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
