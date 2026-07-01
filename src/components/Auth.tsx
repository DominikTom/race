import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  email: string | null
}

/** Logowanie e-mail + hasło (bez magic-link — Supabase limituje maile). */
export default function Auth({ email }: Props) {
  const [mail, setMail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (email) {
    return (
      <div className="auth">
        <span className="muted">{email}</span>
        <button onClick={() => supabase?.auth.signOut()}>Wyloguj</button>
      </div>
    )
  }

  async function login() {
    setErr(null)
    setBusy(true)
    const { error } = await supabase!.auth.signInWithPassword({ email: mail, password: pass })
    setBusy(false)
    if (error) setErr('Błędny e-mail lub hasło')
  }

  return (
    <form
      className="auth"
      onSubmit={(e) => {
        e.preventDefault()
        login()
      }}
    >
      <input
        type="email"
        placeholder="e-mail"
        value={mail}
        onChange={(e) => setMail(e.target.value)}
        autoComplete="username"
      />
      <input
        type="password"
        placeholder="hasło"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        autoComplete="current-password"
      />
      <button type="submit" disabled={busy || !mail || !pass}>
        {busy ? '…' : 'Zaloguj'}
      </button>
      {err && <span className="err small">{err}</span>}
    </form>
  )
}
