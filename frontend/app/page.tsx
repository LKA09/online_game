'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'firebase/auth'
import { getAuthInstance } from '@/lib/firebase'

export default function LoginPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuthInstance(), user => {
      if (user) router.push('/chat')
      else setChecking(false)
    })
    return unsub
  }, [router])

  async function signInWithGoogle() {
    setSigning(true)
    setError('')
    try {
      await signInWithPopup(getAuthInstance(), new GoogleAuthProvider())
    } catch {
      setError('로그인에 실패했어요. 다시 시도해주세요.')
      setSigning(false)
    }
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.875rem' }}>
        로딩 중...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#fff', letterSpacing: '-0.04em', marginBottom: '6px' }}>채팅</h1>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.875rem' }}>구글 계정으로 로그인해서 채팅하세요</p>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '2rem', width: '280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={signInWithGoogle}
            disabled={signing}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              background: signing ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '10px', padding: '11px 16px',
              color: signing ? 'rgba(255,255,255,0.3)' : '#fff',
              fontSize: '0.875rem', fontWeight: 600,
              cursor: signing ? 'not-allowed' : 'pointer',
              transition: 'all 0.12s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {signing ? '로그인 중...' : 'Google로 시작하기'}
          </button>
          {error && <p style={{ color: '#f87171', fontSize: '0.75rem', textAlign: 'center', margin: 0 }}>{error}</p>}
        </div>
      </div>
    </div>
  )
}
