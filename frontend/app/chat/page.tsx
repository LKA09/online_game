'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { ref, onValue, push, onDisconnect, set, get, update, query, limitToLast, orderByChild } from 'firebase/database'
import { getAuthInstance, getDb } from '@/lib/firebase'

type Message = {
  id: string
  uid: string
  name: string
  photoURL: string
  text: string
  createdAt: number
}

type OnlineUser = {
  id: string
  name: string
  photoURL: string
}

export default function ChatPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ uid: string; name: string; photoURL: string } | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [nicknameModal, setNicknameModal] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return onAuthStateChanged(getAuthInstance(), async u => {
      if (!u) { router.push('/'); return }
      const snap = await get(ref(getDb(), `nicknames/${u.uid}`))
      const savedName = snap.val() as string | null
      const me = { uid: u.uid, name: savedName ?? u.displayName ?? '익명', photoURL: u.photoURL ?? '' }
      setUser(me)
      const presenceRef = ref(getDb(), `presence/${u.uid}`)
      set(presenceRef, { name: me.name, photoURL: me.photoURL, online: true })
      onDisconnect(presenceRef).remove()
    })
  }, [router])

  async function saveNickname() {
    const name = nicknameInput.trim()
    if (!name || !user) return
    await set(ref(getDb(), `nicknames/${user.uid}`), name)
    await update(ref(getDb(), `presence/${user.uid}`), { name })
    setUser(prev => prev ? { ...prev, name } : prev)
    setNicknameModal(false)
  }

  useEffect(() => {
    const q = query(ref(getDb(), 'chat'), orderByChild('createdAt'), limitToLast(100))
    return onValue(q, snap => {
      const msgs: Message[] = []
      snap.forEach(child => msgs.push({ id: child.key!, ...child.val() }))
      setMessages(msgs)
    })
  }, [])

  useEffect(() => {
    return onValue(ref(getDb(), 'presence'), snap => {
      const users: OnlineUser[] = []
      snap.forEach(child => users.push({ id: child.key!, ...child.val() }))
      setOnlineUsers(users)
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || !user || sending) return
    setSending(true)

    const spoofMatch = input.match(/^\/속이기\s+"([^"]+)"\s+"([^"]+)"$/)
    if (spoofMatch) {
      const [, fakeName, fakeText] = spoofMatch
      // find photoURL from online users if name matches
      const target = onlineUsers.find(u => u.name === fakeName)
      await push(ref(getDb(), 'chat'), {
        uid: target?.id ?? 'spoof_' + fakeName,
        name: fakeName,
        photoURL: target?.photoURL ?? '',
        text: fakeText,
        createdAt: Date.now(),
      })
    } else {
      await push(ref(getDb(), 'chat'), {
        uid: user.uid,
        name: user.name,
        photoURL: user.photoURL,
        text: input.trim(),
        createdAt: Date.now(),
      })
    }

    setInput('')
    setSending(false)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (!user) return (
    <div style={{ height: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.875rem' }}>
      로딩 중...
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d0d', color: '#fff' }}>

      {/* Nickname modal */}
      {nicknameModal && (
        <div
          onClick={() => setNicknameModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '1.5rem', width: '300px', display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <p style={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff', margin: 0 }}>닉네임 변경</p>
            <input
              autoFocus
              value={nicknameInput}
              onChange={e => setNicknameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setNicknameModal(false) }}
              maxLength={20}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '10px 14px', color: '#fff', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setNicknameModal(false)} style={{ flex: 1, padding: '9px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>취소</button>
              <button onClick={saveNickname} disabled={!nicknameInput.trim()} style={{ flex: 1, padding: '9px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700, background: nicknameInput.trim() ? '#fff' : 'rgba(255,255,255,0.06)', color: nicknameInput.trim() ? '#000' : 'rgba(255,255,255,0.2)', border: 'none', cursor: nicknameInput.trim() ? 'pointer' : 'default' }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ height: '52px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => { setNicknameInput(user.name); setNicknameModal(true) }}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {user.photoURL
            ? <img src={user.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.15)' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800, color: 'rgba(255,255,255,0.5)' }}>{user.name[0]}</div>
          }
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'rgba(255,255,255,0.85)' }}>{user.name}</span>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)' }}>✏️</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.6)' }}>채팅</span>
          <button
            onClick={() => { signOut(getAuthInstance()); router.push('/') }}
            style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}
            onMouseOver={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
            onMouseOut={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: '200px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>온라인 {onlineUsers.length}명</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {onlineUsers.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '8px', background: u.id === user.uid ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
                {u.photoURL
                  ? <img src={u.photoURL} alt="" style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }} />
                  : <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>{u.name[0]}</div>
                }
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: u.id === user.uid ? '#fff' : 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.name}
                  {u.id === user.uid && <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem' }}> 나</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.15)', fontSize: '0.85rem' }}>
                첫 메시지를 보내보세요!
              </div>
            )}
            {messages.map((msg, i) => {
              const isMe = msg.uid === user.uid
              const prev = messages[i - 1]
              const showHeader = !prev || prev.uid !== msg.uid
              const time = new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

              return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: '8px', marginTop: showHeader ? '14px' : '2px' }}>

                  {/* Avatar (others only) */}
                  {!isMe && (
                    <div style={{ width: 32, flexShrink: 0 }}>
                      {showHeader && (
                        msg.photoURL
                          ? <img src={msg.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)' }} />
                          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)' }}>{msg.name[0]}</div>
                      )}
                    </div>
                  )}

                  <div style={{ maxWidth: '65%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: '3px' }}>
                    {showHeader && !isMe && (
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginLeft: '2px' }}>{msg.name}</span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '5px', flexDirection: isMe ? 'row-reverse' : 'row' }}>
                      <div style={{
                        padding: '9px 13px',
                        borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        background: isMe ? '#fff' : 'rgba(255,255,255,0.08)',
                        color: isMe ? '#000' : 'rgba(255,255,255,0.9)',
                        fontSize: '0.875rem',
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                      }}>
                        {msg.text}
                      </div>
                      <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.18)', flexShrink: 0, paddingBottom: '2px' }}>{time}</span>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', padding: '12px 1.25rem', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요... (Enter 전송, Shift+Enter 줄바꿈)"
              rows={1}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                padding: '10px 14px',
                color: '#fff',
                fontSize: '0.875rem',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                maxHeight: '120px',
                overflowY: 'auto',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              style={{
                padding: '10px 18px',
                borderRadius: '12px',
                fontSize: '0.875rem',
                fontWeight: 700,
                border: 'none',
                cursor: input.trim() && !sending ? 'pointer' : 'default',
                transition: 'all 0.12s',
                flexShrink: 0,
                background: input.trim() && !sending ? '#fff' : 'rgba(255,255,255,0.06)',
                color: input.trim() && !sending ? '#000' : 'rgba(255,255,255,0.2)',
              }}
            >
              전송
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
