'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { ref, onValue, push, onDisconnect, set, get, update, query, limitToLast, orderByChild, remove } from 'firebase/database'
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

type ActiveGame = {
  id: string
  name: string
  type: 'mafia' | 'wordchain'
  status: string
  hostName: string
  playerCount: number
}

export default function ChatPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ uid: string; name: string; photoURL: string } | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [activeGames, setActiveGames] = useState<ActiveGame[]>([])
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
      snap.forEach(child => { msgs.push({ id: child.key!, ...child.val() }) })
      setMessages(msgs)
    })
  }, [])

  useEffect(() => {
    return onValue(ref(getDb(), 'presence'), snap => {
      const users: OnlineUser[] = []
      snap.forEach(child => { users.push({ id: child.key!, ...child.val() }) })
      setOnlineUsers(users)
    })
  }, [])

  // Listen to active games
  useEffect(() => {
    return onValue(ref(getDb(), 'games'), snap => {
      const games: ActiveGame[] = []
      snap.forEach(child => {
        const g = child.val()
        if (g.status !== 'ended') {
          games.push({
            id: child.key!,
            name: g.name,
            type: g.type,
            status: g.status,
            hostName: g.hostName,
            playerCount: Object.keys(g.players || {}).length,
          })
        }
      })
      setActiveGames(games)
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function findGameByName(name: string): Promise<string | null> {
    const snap = await get(ref(getDb(), 'games'))
    if (!snap.exists()) return null
    let foundId: string | null = null
    snap.forEach(child => {
      const g = child.val()
      if (g.name === name && g.status !== 'ended') foundId = child.key
    })
    return foundId
  }

  async function sendMessage() {
    if (!input.trim() || !user || sending) return
    setSending(true)

    const text = input.trim()

    // /속이기 "이름" "내용"
    const spoofMatch = text.match(/^\/속이기\s+"([^"]+)"\s+"([^"]+)"$/)
    if (spoofMatch) {
      const [, fakeName, fakeText] = spoofMatch
      const target = onlineUsers.find(u => u.name === fakeName)
      await push(ref(getDb(), 'chat'), {
        uid: target?.id ?? 'spoof_' + fakeName,
        name: fakeName, photoURL: target?.photoURL ?? '',
        text: fakeText, createdAt: Date.now(),
      })
      setInput('')
      setSending(false)
      textareaRef.current?.focus()
      return
    }

    // /게임 마피아 N N N
    const mafiaMatch = text.match(/^\/게임\s+마피아\s+(\d+)\s+(\d+)\s+(\d+)$/)
    if (mafiaMatch) {
      const [, m, p, d] = mafiaMatch.map(Number)
      const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const gameName = `마피아-${Math.floor(Math.random() * 9000) + 1000}`
      await set(ref(getDb(), `games/${gameId}`), {
        name: gameName, type: 'mafia', status: 'waiting',
        hostUid: user.uid, hostName: user.name, createdAt: Date.now(),
        settings: { mafiaCount: m, policeCount: p, doctorCount: d },
        players: { [user.uid]: { name: user.name, photoURL: user.photoURL, isAlive: true } },
      })
      await push(ref(getDb(), 'chat'), {
        uid: 'system', name: '시스템',
        text: `🎮 ${user.name}님이 마피아 게임을 만들었습니다!\n방 이름: "${gameName}" (마피아 ${m}명 / 경찰 ${p}명 / 의사 ${d}명)\n/참여 ${gameName}  또는  /구경 ${gameName}`,
        createdAt: Date.now(),
      })
      setInput('')
      setSending(false)
      router.push(`/game/${gameId}`)
      return
    }

    // /게임 끝말잇기
    const wordchainMatch = text.match(/^\/게임\s+끝말잇기$/)
    if (wordchainMatch) {
      const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const gameName = `끝말잇기-${Math.floor(Math.random() * 9000) + 1000}`
      await set(ref(getDb(), `games/${gameId}`), {
        name: gameName, type: 'wordchain', status: 'waiting',
        hostUid: user.uid, hostName: user.name, createdAt: Date.now(),
        players: { [user.uid]: { name: user.name, photoURL: user.photoURL, isAlive: true } },
      })
      await push(ref(getDb(), 'chat'), {
        uid: 'system', name: '시스템',
        text: `🔤 ${user.name}님이 끝말잇기 게임을 만들었습니다!\n방 이름: "${gameName}"\n/참여 ${gameName}  또는  /구경 ${gameName}`,
        createdAt: Date.now(),
      })
      setInput('')
      setSending(false)
      router.push(`/game/${gameId}`)
      return
    }

    // /참여 이름
    const joinMatch = text.match(/^\/참여\s+(.+)$/)
    if (joinMatch) {
      const gameName = joinMatch[1].replace(/^"|"$/g, '').trim()
      const gameId = await findGameByName(gameName)
      if (!gameId) {
        await push(ref(getDb(), 'chat'), {
          uid: 'system', name: '시스템',
          text: `❌ "${gameName}" 게임을 찾을 수 없습니다.`,
          createdAt: Date.now(),
        })
      } else {
        await set(ref(getDb(), `games/${gameId}/players/${user.uid}`), {
          name: user.name, photoURL: user.photoURL, isAlive: true,
        })
        router.push(`/game/${gameId}`)
      }
      setInput('')
      setSending(false)
      textareaRef.current?.focus()
      return
    }

    // /구경 이름
    const spectateMatch = text.match(/^\/구경\s+(.+)$/)
    if (spectateMatch) {
      const gameName = spectateMatch[1].replace(/^"|"$/g, '').trim()
      const gameId = await findGameByName(gameName)
      if (!gameId) {
        await push(ref(getDb(), 'chat'), {
          uid: 'system', name: '시스템',
          text: `❌ "${gameName}" 게임을 찾을 수 없습니다.`,
          createdAt: Date.now(),
        })
      } else {
        await set(ref(getDb(), `games/${gameId}/spectators/${user.uid}`), {
          name: user.name, photoURL: user.photoURL,
        })
        router.push(`/game/${gameId}`)
      }
      setInput('')
      setSending(false)
      textareaRef.current?.focus()
      return
    }

    // Normal message
    await push(ref(getDb(), 'chat'), {
      uid: user.uid, name: user.name, photoURL: user.photoURL,
      text, createdAt: Date.now(),
    })

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

  const isSystemMsg = (uid: string) => uid === 'system'

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d0d', color: '#fff' }}>

      {/* Nickname modal */}
      {nicknameModal && (
        <div onClick={() => setNicknameModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '1.5rem', width: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff', margin: 0 }}>닉네임 변경</p>
            <input
              autoFocus value={nicknameInput}
              onChange={e => setNicknameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setNicknameModal(false) }}
              maxLength={20}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setNicknameModal(false)} style={{ flex: 1, padding: 9, borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>취소</button>
              <button onClick={saveNickname} disabled={!nicknameInput.trim()} style={{ flex: 1, padding: 9, borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, background: nicknameInput.trim() ? '#fff' : 'rgba(255,255,255,0.06)', color: nicknameInput.trim() ? '#000' : 'rgba(255,255,255,0.2)', border: 'none', cursor: nicknameInput.trim() ? 'pointer' : 'default' }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ height: 52, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => { setNicknameInput(user.name); setNicknameModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {user.photoURL
            ? <img src={user.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.15)' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800, color: 'rgba(255,255,255,0.5)' }}>{user.name[0]}</div>
          }
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'rgba(255,255,255,0.85)' }}>{user.name}</span>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)' }}>✏️</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.6)' }}>채팅</span>
          <button onClick={() => { signOut(getAuthInstance()); router.push('/') }} style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}
            onMouseOver={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
            onMouseOut={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}>
            로그아웃
          </button>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Active games section */}
          {activeGames.length > 0 && (
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '8px 0' }}>
              <div style={{ padding: '4px 14px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>🎮 게임 {activeGames.length}개</span>
              </div>
              {activeGames.map(g => (
                <div key={g.id} style={{ padding: '5px 8px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '6px 8px' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fff', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.type === 'mafia' ? '🔪' : '🔤'} {g.name}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', marginBottom: 5 }}>
                      {g.status === 'waiting' ? `대기 중 · ${g.playerCount}명` : `진행 중 · ${g.playerCount}명`}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={async () => {
                          await set(ref(getDb(), `games/${g.id}/players/${user.uid}`), { name: user.name, photoURL: user.photoURL, isAlive: true })
                          router.push(`/game/${g.id}`)
                        }}
                        style={{ flex: 1, padding: '4px 0', borderRadius: 6, fontSize: '0.65rem', fontWeight: 700, background: '#fff', color: '#000', border: 'none', cursor: 'pointer' }}
                      >
                        참여
                      </button>
                      <button
                        onClick={async () => {
                          await set(ref(getDb(), `games/${g.id}/spectators/${user.uid}`), { name: user.name, photoURL: user.photoURL })
                          router.push(`/game/${g.id}`)
                        }}
                        style={{ flex: 1, padding: '4px 0', borderRadius: 6, fontSize: '0.65rem', fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: 'none', cursor: 'pointer' }}
                      >
                        구경
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Online users */}
          <div style={{ padding: '8px 14px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>온라인 {onlineUsers.length}명</span>
          </div>
          <div style={{ flex: 1, padding: '0 6px 6px' }}>
            {onlineUsers.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: u.id === user.uid ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
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
              const isSystem = isSystemMsg(msg.uid)
              const prev = messages[i - 1]
              const showHeader = !prev || prev.uid !== msg.uid
              const time = new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

              if (isSystem) {
                return (
                  <div key={msg.id} style={{ textAlign: 'center', margin: '8px 0' }}>
                    <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)', padding: '5px 14px', borderRadius: 20, display: 'inline-block', whiteSpace: 'pre-wrap', textAlign: 'left' as const }}>
                      {msg.text}
                    </span>
                  </div>
                )
              }

              return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, marginTop: showHeader ? 14 : 2 }}>
                  {!isMe && (
                    <div style={{ width: 32, flexShrink: 0 }}>
                      {showHeader && (
                        msg.photoURL
                          ? <img src={msg.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)' }} />
                          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)' }}>{msg.name[0]}</div>
                      )}
                    </div>
                  )}
                  <div style={{ maxWidth: '65%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 3 }}>
                    {showHeader && !isMe && (
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginLeft: 2 }}>{msg.name}</span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, flexDirection: isMe ? 'row-reverse' : 'row' }}>
                      <div style={{ padding: '9px 13px', borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isMe ? '#fff' : 'rgba(255,255,255,0.08)', color: isMe ? '#000' : 'rgba(255,255,255,0.9)', fontSize: '0.875rem', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        {msg.text}
                      </div>
                      <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.18)', flexShrink: 0, paddingBottom: 2 }}>{time}</span>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* Command hint */}
          {input.startsWith('/') && (
            <div style={{ flexShrink: 0, padding: '6px 1.25rem', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.8 }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>/게임 마피아 2 1 1</span> — 마피아수 경찰수 의사수
                {'  '}
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>/게임 끝말잇기</span>
                {'  '}
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>/참여 방이름</span>
                {'  '}
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>/구경 방이름</span>
              </div>
            </div>
          )}

          {/* Input */}
          <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', padding: '12px 1.25rem', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지 또는 /게임 마피아 2 1 1 · /게임 끝말잇기 · /참여 방이름 · /구경 방이름"
              rows={1}
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: '0.875rem', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto' }}
            />
            <button onClick={sendMessage} disabled={!input.trim() || sending} style={{ padding: '10px 18px', borderRadius: 12, fontSize: '0.875rem', fontWeight: 700, border: 'none', cursor: input.trim() && !sending ? 'pointer' : 'default', transition: 'all 0.12s', flexShrink: 0, background: input.trim() && !sending ? '#fff' : 'rgba(255,255,255,0.06)', color: input.trim() && !sending ? '#000' : 'rgba(255,255,255,0.2)' }}>
              전송
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
