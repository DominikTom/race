import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  email: string | null
}

/** Logowanie magic-link (email). Widoczne tylko gdy Supabase skonfigurowany. */
export default function Auth({ email }: Props) {
  const [input, setInput] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (email) {
    return (
      <div className="auth">
        <span className="muted">{email}</span>
        <button onClick={() => supabase?.auth.signOut()}>Wyloguj</button>
      </div>
    )
  }

  async function send() {
    setErr(null)
    const { error } = await supabase!.auth.signInWithOtp({
      email: input,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) setErr(error.message)
    else setSent(true)
  }

  return (
    <div className="auth">
      {sent ? (
        <span className="muted">Sprawdź skrzynkę — wysłano magic-link.</span>
      ) : (
        <>
          <input
            type="email"
            placeholder="email"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button onClick={send} disabled={!input.includes('@')}>
            Wyślij link
          </button>
        </>
      )}
      {err && <span className="err">{err}</span>}
    </div>
  )
}
