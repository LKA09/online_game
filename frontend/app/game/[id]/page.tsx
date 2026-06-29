'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { ref, onValue, push, set, update, remove, get } from 'firebase/database'
import { getAuthInstance, getDb } from '@/lib/firebase'

type Role = 'mafia' | 'police' | 'doctor' | 'citizen'
type GameType = 'mafia' | 'wordchain'
type GameStatus = 'waiting' | 'playing' | 'ended'
type MafiaPhase = 'day' | 'vote' | 'night'
type User = { uid: string; name: string; photoURL: string }

interface PlayerData {
  name: string
  photoURL: string
  role?: Role
  isAlive?: boolean
}

interface GameMsg {
  id: string
  uid: string
  name: string
  photoURL?: string
  text: string
  createdAt: number
  isSystem?: boolean
  spectator?: boolean
  policeOnly?: boolean
  policeUid?: string
}

interface Game {
  id: string
  name: string
  type: GameType
  status: GameStatus
  hostUid: string
  hostName: string
  createdAt: number
  winner?: string
  settings?: { mafiaCount: number; policeCount: number; doctorCount: number }
  phase?: MafiaPhase
  round?: number
  votes?: Record<string, string>
  nightKill?: string
  nightSave?: string
  nightInvestigate?: string
  nightInvestigateResult?: string
  currentWord?: string
  lastChar?: string
  currentPlayerUid?: string
  turnIndex?: number
  turnOrder?: string[]
  usedWords?: Record<string, boolean>
  players: Record<string, PlayerData>
  spectators?: Record<string, { name: string; photoURL: string }>
}

const ROLE_LABELS: Record<Role, string> = {
  mafia: '🔪 마피아', police: '🚔 경찰', doctor: '💊 의사', citizen: '👤 시민',
}
const ROLE_COLORS: Record<Role, string> = {
  mafia: '#ef4444', police: '#3b82f6', doctor: '#22c55e', citizen: '#94a3b8',
}

export default function GamePage() {
  const router = useRouter()
  const params = useParams()
  const rawId = params?.id
  const gameId = Array.isArray(rawId) ? rawId[0] : (rawId ?? '')

  const [user, setUser] = useState<User | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [messages, setMessages] = useState<GameMsg[]>([])
  const [input, setInput] = useState('')
  const [wordInput, setWordInput] = useState('')
  const [wordError, setWordError] = useState('')
  const [loading, setLoading] = useState(true)
  const [myVote, setMyVote] = useState<string | null>(null)
  const [myNightAction, setMyNightAction] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return onAuthStateChanged(getAuthInstance(), async u => {
      if (!u) { router.push('/'); return }
      const snap = await get(ref(getDb(), `nicknames/${u.uid}`))
      const savedName = snap.val() as string | null
      setUser({ uid: u.uid, name: savedName ?? u.displayName ?? '익명', photoURL: u.photoURL ?? '' })
    })
  }, [router])

  useEffect(() => {
    if (!gameId) return
    return onValue(ref(getDb(), `games/${gameId}`), snap => {
      if (!snap.exists()) { router.push('/chat'); return }
      setGame({ id: gameId, ...snap.val() })
      setLoading(false)
    })
  }, [gameId, router])

  useEffect(() => {
    if (!gameId) return
    return onValue(ref(getDb(), `games/${gameId}/messages`), snap => {
      const msgs: GameMsg[] = []
      snap.forEach(child => { msgs.push({ id: child.key!, ...child.val() }) })
      setMessages(msgs.sort((a, b) => a.createdAt - b.createdAt))
    })
  }, [gameId])

  useEffect(() => {
    if (!gameId || !user) return
    return onValue(ref(getDb(), `games/${gameId}/votes/${user.uid}`), snap => {
      setMyVote(snap.val() ?? null)
    })
  }, [gameId, user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (loading || !user) {
    return (
      <div style={{ height: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.875rem' }}>
        로딩 중...
      </div>
    )
  }
  if (!game) return null

  // After null checks — these are safe to use as non-null
  const me = user as User
  const g = game as Game

  const isHost = g.hostUid === me.uid
  const myPlayer = g.players?.[me.uid]
  const isSpectator = !myPlayer && !!g.spectators?.[me.uid]
  const myRole = myPlayer?.role as Role | undefined
  const amAlive = myPlayer?.isAlive !== false

  const playerList = Object.entries(g.players || {})
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => (a.name > b.name ? 1 : -1))

  const alivePlayers = playerList.filter(p => p.isAlive !== false)
  const spectatorList = Object.entries(g.spectators || {}).map(([uid, s]) => ({ uid, ...s }))

  const myMafiaAllies = myRole === 'mafia'
    ? playerList.filter(p => p.uid !== me.uid && p.role === 'mafia')
    : []

  const isMyTurn = g.type === 'wordchain' && g.currentPlayerUid === me.uid && !isSpectator && g.status === 'playing' && amAlive

  // ===== HELPERS =====

  function checkWinCondition(players: Record<string, PlayerData>): 'mafia' | 'citizen' | null {
    const alive = Object.values(players).filter(p => p.isAlive !== false)
    const mafiaAlive = alive.filter(p => p.role === 'mafia').length
    const othersAlive = alive.filter(p => p.role !== 'mafia').length
    if (mafiaAlive === 0) return 'citizen'
    if (mafiaAlive >= othersAlive) return 'mafia'
    return null
  }

  async function sysMsg(text: string, extra?: Partial<GameMsg>) {
    await push(ref(getDb(), `games/${gameId}/messages`), {
      uid: 'system', name: '시스템', text, createdAt: Date.now(), isSystem: true, ...extra,
    })
  }

  // ===== JOIN / LEAVE =====

  async function joinAsPlayer() {
    await set(ref(getDb(), `games/${gameId}/players/${me.uid}`), {
      name: me.name, photoURL: me.photoURL, isAlive: true,
    })
    if (g.spectators?.[me.uid]) {
      await remove(ref(getDb(), `games/${gameId}/spectators/${me.uid}`))
    }
  }

  async function joinAsSpectator() {
    await set(ref(getDb(), `games/${gameId}/spectators/${me.uid}`), {
      name: me.name, photoURL: me.photoURL,
    })
    if (g.players?.[me.uid]) {
      await remove(ref(getDb(), `games/${gameId}/players/${me.uid}`))
    }
  }

  async function leaveGame() {
    await remove(ref(getDb(), `games/${gameId}/players/${me.uid}`))
    await remove(ref(getDb(), `games/${gameId}/spectators/${me.uid}`))
    router.push('/chat')
  }

  async function deleteGame() {
    if (!isHost) return
    await remove(ref(getDb(), `games/${gameId}`))
    router.push('/chat')
  }

  // ===== CHAT =====

  async function sendMessage() {
    if (!input.trim()) return
    if (!myPlayer && !isSpectator) return
    await push(ref(getDb(), `games/${gameId}/messages`), {
      uid: me.uid, name: me.name, photoURL: me.photoURL,
      text: input.trim(), createdAt: Date.now(),
      ...(isSpectator ? { spectator: true } : {}),
    })
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // ===== MAFIA GAME =====

  async function startMafiaGame() {
    if (!isHost || !g.settings) return
    const uids = Object.keys(g.players || {})
    const { mafiaCount, policeCount, doctorCount } = g.settings
    if (uids.length < mafiaCount + policeCount + doctorCount) {
      alert(`최소 ${mafiaCount + policeCount + doctorCount}명 이상 필요합니다. (현재 ${uids.length}명)`); return
    }
    const roles: Role[] = [
      ...Array(mafiaCount).fill('mafia') as Role[],
      ...Array(policeCount).fill('police') as Role[],
      ...Array(doctorCount).fill('doctor') as Role[],
      ...Array(uids.length - mafiaCount - policeCount - doctorCount).fill('citizen') as Role[],
    ]
    const shuffled = [...uids].sort(() => Math.random() - 0.5)
    const updates: Record<string, unknown> = { status: 'playing', phase: 'day', round: 1 }
    shuffled.forEach((uid, i) => {
      updates[`players/${uid}/role`] = roles[i]
      updates[`players/${uid}/isAlive`] = true
    })
    await update(ref(getDb(), `games/${gameId}`), updates)
    await sysMsg('🎮 게임이 시작됩니다! 각자 역할을 확인하세요. ☀️ 낮 1일차가 시작됩니다.')
  }

  async function startVote() {
    if (!isHost) return
    await update(ref(getDb(), `games/${gameId}`), { phase: 'vote', votes: null })
    await sysMsg('🗳️ 투표가 시작됩니다! 마피아라고 의심되는 사람에게 투표하세요.')
  }

  async function submitVote(targetUid: string) {
    if (!amAlive || g.phase !== 'vote') return
    await set(ref(getDb(), `games/${gameId}/votes/${me.uid}`), targetUid)
    setMyVote(targetUid)
  }

  async function resolveVote() {
    if (!isHost) return
    const votes = g.votes || {}
    const voteCounts: Record<string, number> = {}
    alivePlayers.forEach(p => { voteCounts[p.uid] = 0 })
    Object.values(votes).forEach(t => { if (t in voteCounts) voteCounts[t]++ })

    let maxV = 0, eliminated: string | null = null, tie = false
    Object.entries(voteCounts).forEach(([uid, c]) => {
      if (c > maxV) { maxV = c; eliminated = uid; tie = false }
      else if (c === maxV && c > 0) { tie = true; eliminated = null }
    })

    const updatedPlayers = { ...g.players }
    if (eliminated && !tie) {
      updatedPlayers[eliminated] = { ...updatedPlayers[eliminated], isAlive: false }
    }
    const winner = checkWinCondition(updatedPlayers)

    const updates: Record<string, unknown> = {
      phase: winner ? undefined : 'night',
      status: winner ? 'ended' : 'playing',
      winner: winner ?? undefined,
      votes: null,
      nightKill: null, nightSave: null, nightInvestigate: null, nightInvestigateResult: null,
    }
    if (eliminated && !tie) updates[`players/${eliminated}/isAlive`] = false

    let msg = eliminated && !tie
      ? `🗳️ 투표 결과: ${g.players[eliminated].name}이(가) 처형되었습니다.`
      : '🗳️ 투표 결과: 동률로 아무도 처형되지 않았습니다.'

    if (winner) msg += ` | 🎉 게임 종료! ${winner === 'mafia' ? '마피아' : '시민'} 팀 승리!`
    else msg += ' | 🌙 밤이 되었습니다...'

    await update(ref(getDb(), `games/${gameId}`), updates)
    await sysMsg(msg)
  }

  async function submitNightKill(targetUid: string) {
    if (myRole !== 'mafia' || !amAlive) return
    await set(ref(getDb(), `games/${gameId}/nightKill`), targetUid)
    setMyNightAction(targetUid)
  }

  async function submitNightSave(targetUid: string) {
    if (myRole !== 'doctor' || !amAlive) return
    await set(ref(getDb(), `games/${gameId}/nightSave`), targetUid)
    setMyNightAction(targetUid)
  }

  async function submitNightInvestigate(targetUid: string) {
    if (myRole !== 'police' || !amAlive) return
    await set(ref(getDb(), `games/${gameId}/nightInvestigate`), targetUid)
    const targetRole = g.players[targetUid]?.role
    await set(ref(getDb(), `games/${gameId}/nightInvestigateResult`), targetRole === 'mafia' ? 'mafia' : 'not_mafia')
    setMyNightAction(targetUid)
  }

  async function resolveMorning() {
    if (!isHost) return
    const killed = g.nightKill
    const saved = g.nightSave
    const actualKilled = killed && killed !== saved ? killed : null

    const updatedPlayers = { ...g.players }
    if (actualKilled) updatedPlayers[actualKilled] = { ...updatedPlayers[actualKilled], isAlive: false }
    const winner = checkWinCondition(updatedPlayers)

    const updates: Record<string, unknown> = {
      phase: winner ? undefined : 'day',
      status: winner ? 'ended' : 'playing',
      winner: winner ?? undefined,
      round: (g.round || 1) + 1,
      nightKill: null, nightSave: null, nightInvestigate: null, nightInvestigateResult: null,
    }
    if (actualKilled) updates[`players/${actualKilled}/isAlive`] = false

    let msg = '☀️ 아침이 되었습니다. '
    if (actualKilled) msg += `${g.players[actualKilled].name}이(가) 밤에 사망했습니다.`
    else if (killed && killed === saved) msg += '의사 덕분에 아무도 사망하지 않았습니다.'
    else msg += '평화로운 밤이었습니다. 아무도 사망하지 않았습니다.'

    if (winner) msg += ` | 🎉 게임 종료! ${winner === 'mafia' ? '마피아' : '시민'} 팀 승리!`

    await update(ref(getDb(), `games/${gameId}`), updates)
    await sysMsg(msg)
    setMyNightAction(null)

    if (g.nightInvestigate && g.nightInvestigateResult) {
      const investigatedName = g.players[g.nightInvestigate]?.name
      const resultLabel = g.nightInvestigateResult === 'mafia' ? '마피아입니다! 🔪' : '마피아가 아닙니다. ✅'
      const policeUid = Object.entries(g.players).find(([, p]) => p.role === 'police')?.[0]
      await push(ref(getDb(), `games/${gameId}/messages`), {
        uid: 'system', name: '🚔 경찰 전용',
        text: `[조사 결과] ${investigatedName}은(는) ${resultLabel}`,
        createdAt: Date.now() + 1,
        isSystem: true, policeOnly: true, policeUid,
      })
    }
  }

  // ===== WORDCHAIN =====

  async function startWordchain() {
    if (!isHost) return
    const uids = Object.keys(g.players || {})
    if (uids.length < 2) { alert('최소 2명 이상 필요합니다.'); return }
    const shuffled = [...uids].sort(() => Math.random() - 0.5)
    await update(ref(getDb(), `games/${gameId}`), {
      status: 'playing', turnOrder: shuffled, turnIndex: 0,
      currentPlayerUid: shuffled[0], currentWord: null, lastChar: null, usedWords: {},
    })
    await sysMsg(`🎮 끝말잇기 시작! 순서: ${shuffled.map(u => g.players[u]?.name).join(' → ')}\n첫 번째: ${g.players[shuffled[0]]?.name}`)
  }

  async function submitWord() {
    const word = wordInput.trim()
    if (!word || !isMyTurn) return
    if (word.length < 2) { setWordError('두 글자 이상 입력하세요'); return }
    if (g.lastChar && word[0] !== g.lastChar) {
      setWordError(`"${g.lastChar}"(으)로 시작하는 단어를 입력하세요`); return
    }
    if (g.usedWords?.[word]) { setWordError('이미 사용된 단어입니다'); return }

    const turnOrder = g.turnOrder!
    const nextIdx = ((g.turnIndex ?? 0) + 1) % turnOrder.length
    await update(ref(getDb(), `games/${gameId}`), {
      currentWord: word, lastChar: word[word.length - 1],
      turnIndex: nextIdx, currentPlayerUid: turnOrder[nextIdx],
      [`usedWords/${word}`]: true,
    })
    await push(ref(getDb(), `games/${gameId}/messages`), {
      uid: me.uid, name: me.name, photoURL: me.photoURL,
      text: word, createdAt: Date.now(),
    })
    setWordInput('')
    setWordError('')
  }

  function handleWordKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); submitWord() }
  }

  // ===== STYLE CONSTANTS =====

  const S = {
    page: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d0d', color: '#fff', fontFamily: 'inherit' } as React.CSSProperties,
    header: { height: 52, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } as React.CSSProperties,
    btn: { padding: '7px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.08)', color: '#fff' } as React.CSSProperties,
    btnPrimary: { padding: '7px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: '#fff', color: '#000' } as React.CSSProperties,
    btnDanger: { padding: '7px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.15)', color: '#ef4444' } as React.CSSProperties,
    body: { flex: 1, display: 'flex', overflow: 'hidden' } as React.CSSProperties,
    sidebar: { width: 180, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto', padding: 8 } as React.CSSProperties,
    main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } as React.CSSProperties,
    chatArea: { flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: 2 } as React.CSSProperties,
    inputArea: { flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.07)', padding: '10px 1rem', display: 'flex', gap: 8, alignItems: 'flex-end' } as React.CSSProperties,
    phaseBar: { flexShrink: 0, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as React.CSSProperties,
    tag: { fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.05em', padding: '2px 7px', borderRadius: 6, display: 'inline-block' } as React.CSSProperties,
  }

  // ===== SUB-COMPONENTS =====

  function Avatar({ name, photoURL, size = 28 }: { name: string; photoURL?: string; size?: number }) {
    return photoURL
      ? <img src={photoURL} alt="" style={{ width: size, height: size, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }} />
      : <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 800, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>{name[0]}</div>
  }

  function PlayerCard({ uid, name, photoURL, role, isAlive = true, showRole = false }: { uid: string; name: string; photoURL?: string; role?: Role; isAlive?: boolean; showRole?: boolean }) {
    const isMe = uid === me.uid
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: 8, background: isMe ? 'rgba(255,255,255,0.04)' : 'transparent', opacity: isAlive ? 1 : 0.35, marginBottom: 2 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar name={name} photoURL={photoURL} size={26} />
          {!isAlive && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>💀</span>}
        </div>
        <div style={{ overflow: 'hidden', flex: 1 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isAlive ? (isMe ? '#fff' : 'rgba(255,255,255,0.7)') : 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}{isMe && <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.6rem' }}> 나</span>}
          </div>
          {showRole && role && (
            <div style={{ fontSize: '0.6rem', color: ROLE_COLORS[role], fontWeight: 700 }}>{ROLE_LABELS[role]}</div>
          )}
        </div>
      </div>
    )
  }

  function MsgBubble({ m }: { m: GameMsg }) {
    if (m.policeOnly && m.policeUid !== me.uid) return null
    const isMe = m.uid === me.uid
    const time = new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

    if (m.isSystem) {
      return (
        <div style={{ textAlign: 'center', margin: '6px 0' }}>
          <span style={{ fontSize: '0.75rem', color: m.policeOnly ? '#3b82f6' : 'rgba(255,255,255,0.35)', background: m.policeOnly ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)', padding: '4px 12px', borderRadius: 20, display: 'inline-block', whiteSpace: 'pre-wrap' }}>
            {m.text}
          </span>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
        {!isMe && <Avatar name={m.name} photoURL={m.photoURL} size={28} />}
        <div style={{ maxWidth: '65%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 3 }}>
          {!isMe && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)' }}>{m.name}{m.spectator ? ' 👁️' : ''}</span>}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, flexDirection: isMe ? 'row-reverse' : 'row' }}>
            <div style={{ padding: '8px 12px', borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: isMe ? '#fff' : 'rgba(255,255,255,0.08)', color: isMe ? '#000' : 'rgba(255,255,255,0.9)', fontSize: '0.875rem', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {m.text}
            </div>
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.18)', paddingBottom: 2 }}>{time}</span>
          </div>
        </div>
      </div>
    )
  }

  // ===== WAITING ROOM =====
  if (g.status === 'waiting') {
    const inGame = !!myPlayer
    return (
      <div style={S.page}>
        <header style={S.header}>
          <button onClick={leaveGame} style={{ ...S.btn, background: 'none', color: 'rgba(255,255,255,0.4)', padding: '4px 0' }}>← 나가기</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{g.name}</div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>
              {g.type === 'mafia'
                ? `마피아 게임 · 마피아 ${g.settings?.mafiaCount}명 · 경찰 ${g.settings?.policeCount}명 · 의사 ${g.settings?.doctorCount}명`
                : '끝말잇기 게임'}
            </div>
          </div>
          {isHost
            ? <button onClick={deleteGame} style={S.btnDanger}>방 삭제</button>
            : <div style={{ width: 60 }} />}
        </header>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05em', marginBottom: 10 }}>참여자 {playerList.length}명</div>
              {playerList.map(p => <PlayerCard key={p.uid} {...p} showRole={false} />)}
              {playerList.length === 0 && <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem' }}>아직 참여자가 없습니다</div>}
            </div>

            {spectatorList.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05em', marginBottom: 8 }}>구경꾼 {spectatorList.length}명</div>
                {spectatorList.map(s => (
                  <div key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', opacity: 0.5, fontSize: '0.75rem' }}>
                    <Avatar name={s.name} photoURL={s.photoURL} size={22} />
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!inGame && !isSpectator && (
                <button onClick={joinAsPlayer} style={S.btnPrimary}>참여하기</button>
              )}
              {inGame && !isHost && (
                <button onClick={joinAsSpectator} style={S.btn}>구경으로 전환</button>
              )}
              {isSpectator && (
                <button onClick={joinAsPlayer} style={S.btnPrimary}>참여자로 전환</button>
              )}
              {isHost && g.type === 'mafia' && (
                <button onClick={startMafiaGame} style={{ ...S.btnPrimary, background: '#22c55e', color: '#000' }}>
                  게임 시작 ({playerList.length}명)
                </button>
              )}
              {isHost && g.type === 'wordchain' && (
                <button onClick={startWordchain} style={{ ...S.btnPrimary, background: '#22c55e', color: '#000' }}>
                  게임 시작 ({playerList.length}명)
                </button>
              )}
            </div>

            {isHost && g.type === 'mafia' && g.settings && (
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>
                최소 {g.settings.mafiaCount + g.settings.policeCount + g.settings.doctorCount}명 이상 필요합니다
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== GAME ENDED =====
  if (g.status === 'ended') {
    const winnerLabel = g.winner === 'mafia' ? '🔪 마피아 팀 승리!' : '🎉 시민 팀 승리!'
    return (
      <div style={S.page}>
        <header style={S.header}>
          <button onClick={() => router.push('/chat')} style={{ ...S.btn, background: 'none', color: 'rgba(255,255,255,0.4)', padding: '4px 0' }}>← 채팅으로</button>
          <span style={{ fontWeight: 800 }}>{g.name}</span>
          {isHost
            ? <button onClick={deleteGame} style={S.btnDanger}>방 삭제</button>
            : <div style={{ width: 60 }} />}
        </header>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: 16 }}>{winnerLabel}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {playerList.map(p => (
                <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '6px 10px' }}>
                  <Avatar name={p.name} photoURL={p.photoURL} size={22} />
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>{p.name}</div>
                    {p.role && <div style={{ fontSize: '0.65rem', color: ROLE_COLORS[p.role] }}>{ROLE_LABELS[p.role]}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
            {messages.filter(m => !m.policeOnly || m.policeUid === me.uid).map(m => (
              <MsgBubble key={m.id} m={m} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    )
  }

  // ===== PLAYING — MAFIA PHASE UI =====
  function MafiaPhaseUI() {
    const phase = g.phase
    const votes = g.votes || {}
    const voteCount = (uid: string) => Object.values(votes).filter(v => v === uid).length

    return (
      <>
        <div style={S.phaseBar}>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: phase === 'night' ? '#818cf8' : '#fbbf24' }}>
            {phase === 'day' ? `☀️ 낮 ${g.round}일차` : phase === 'vote' ? `🗳️ 투표 중 (${g.round}일차)` : `🌙 밤 ${g.round}일차`}
          </span>
          {myRole && (
            <span style={{ ...S.tag, background: `${ROLE_COLORS[myRole]}22`, color: ROLE_COLORS[myRole] }}>
              {ROLE_LABELS[myRole]}
            </span>
          )}
          {myRole === 'mafia' && myMafiaAllies.length > 0 && (
            <span style={{ fontSize: '0.7rem', color: '#ef4444' }}>
              동료 마피아: {myMafiaAllies.map(p => p.name).join(', ')}
            </span>
          )}
          {isHost && phase === 'day' && <button onClick={startVote} style={{ ...S.btn, marginLeft: 'auto' }}>🗳️ 투표 시작</button>}
          {isHost && phase === 'vote' && <button onClick={resolveVote} style={{ ...S.btn, marginLeft: 'auto' }}>투표 종료</button>}
          {isHost && phase === 'night' && <button onClick={resolveMorning} style={{ ...S.btn, marginLeft: 'auto' }}>☀️ 아침으로</button>}
        </div>

        {(phase === 'vote' || phase === 'night') && amAlive && myRole && (
          <div style={{ flexShrink: 0, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
            {phase === 'vote' && (
              <div>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
                  투표 {myVote ? `완료 → ${g.players[myVote]?.name}` : '(선택하세요)'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {alivePlayers.filter(p => p.uid !== me.uid).map(p => (
                    <button key={p.uid} onClick={() => submitVote(p.uid)} style={{ ...S.btn, background: myVote === p.uid ? '#fff' : 'rgba(255,255,255,0.08)', color: myVote === p.uid ? '#000' : '#fff', fontSize: '0.75rem', padding: '5px 12px' }}>
                      {p.name} {voteCount(p.uid) > 0 && <span style={{ opacity: 0.6 }}>({voteCount(p.uid)})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {phase === 'night' && myRole === 'mafia' && (
              <div>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>
                  🔪 제거할 대상 {myNightAction ? `→ ${g.players[myNightAction]?.name}` : '(선택하세요)'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {alivePlayers.filter(p => p.role !== 'mafia').map(p => (
                    <button key={p.uid} onClick={() => submitNightKill(p.uid)} style={{ ...S.btn, background: myNightAction === p.uid ? '#ef4444' : 'rgba(239,68,68,0.1)', color: myNightAction === p.uid ? '#fff' : '#ef4444', fontSize: '0.75rem', padding: '5px 12px' }}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {phase === 'night' && myRole === 'doctor' && (
              <div>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#22c55e', marginBottom: 6 }}>
                  💊 살릴 대상 {myNightAction ? `→ ${g.players[myNightAction]?.name}` : '(선택하세요)'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {alivePlayers.map(p => (
                    <button key={p.uid} onClick={() => submitNightSave(p.uid)} style={{ ...S.btn, background: myNightAction === p.uid ? '#22c55e' : 'rgba(34,197,94,0.1)', color: myNightAction === p.uid ? '#000' : '#22c55e', fontSize: '0.75rem', padding: '5px 12px' }}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {phase === 'night' && myRole === 'police' && (
              <div>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#3b82f6', marginBottom: 6 }}>
                  🚔 조사할 대상 {myNightAction ? `→ ${g.players[myNightAction]?.name}` : '(선택하세요)'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {alivePlayers.filter(p => p.uid !== me.uid).map(p => (
                    <button key={p.uid} onClick={() => submitNightInvestigate(p.uid)} style={{ ...S.btn, background: myNightAction === p.uid ? '#3b82f6' : 'rgba(59,130,246,0.1)', color: myNightAction === p.uid ? '#fff' : '#3b82f6', fontSize: '0.75rem', padding: '5px 12px' }}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {phase === 'night' && myRole === 'citizen' && (
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', padding: '4px 0' }}>
                💤 밤입니다. 조용히 기다리세요...
              </div>
            )}
          </div>
        )}

        {!amAlive && (
          <div style={{ flexShrink: 0, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>
            💀 사망했습니다. 구경 중...
          </div>
        )}
      </>
    )
  }

  // ===== PLAYING — WORDCHAIN UI =====
  function WordchainUI() {
    const currentPlayer = g.currentPlayerUid ? g.players[g.currentPlayerUid] : null
    const turnOrder = g.turnOrder || []

    return (
      <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontWeight: 700, marginBottom: 2 }}>현재 단어</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, letterSpacing: '-0.03em' }}>
              {g.currentWord ?? '—'}
              {g.lastChar && <span style={{ color: '#fbbf24', marginLeft: 6 }}>→ 「{g.lastChar}」</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontWeight: 700, marginBottom: 4 }}>순서</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {turnOrder.map((uid, i) => {
                const isCurrent = uid === g.currentPlayerUid
                return (
                  <span key={uid} style={{ ...S.tag, background: isCurrent ? '#fbbf24' : 'rgba(255,255,255,0.06)', color: isCurrent ? '#000' : 'rgba(255,255,255,0.4)' }}>
                    {i + 1}. {g.players[uid]?.name}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {isMyTurn ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <input
                autoFocus value={wordInput}
                onChange={e => { setWordInput(e.target.value); setWordError('') }}
                onKeyDown={handleWordKey}
                placeholder={g.lastChar ? `"${g.lastChar}"(으)로 시작하는 단어...` : '첫 단어를 입력하세요...'}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1px solid ${wordError ? '#ef4444' : 'rgba(255,255,255,0.12)'}`, borderRadius: 10, padding: '9px 14px', color: '#fff', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
              {wordError && <div style={{ color: '#ef4444', fontSize: '0.72rem', marginTop: 4 }}>{wordError}</div>}
            </div>
            <button onClick={submitWord} style={S.btnPrimary}>입력</button>
          </div>
        ) : (
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
            {currentPlayer ? `${currentPlayer.name}의 차례입니다...` : '대기 중...'}
          </div>
        )}
      </div>
    )
  }

  // ===== MAIN PLAYING LAYOUT =====
  return (
    <div style={S.page}>
      <header style={S.header}>
        <button onClick={() => router.push('/chat')} style={{ ...S.btn, background: 'none', color: 'rgba(255,255,255,0.4)', padding: '4px 0', fontSize: '0.8rem' }}>← 채팅</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{g.name}</div>
          <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)' }}>
            {g.type === 'mafia' ? '마피아' : '끝말잇기'} · 생존 {alivePlayers.length}/{playerList.length}명
          </div>
        </div>
        {isHost
          ? <button onClick={deleteGame} style={{ ...S.btnDanger, fontSize: '0.72rem', padding: '5px 10px' }}>방 삭제</button>
          : <div style={{ width: 56 }} />}
      </header>

      <div style={S.body}>
        {/* Sidebar — player list */}
        <div style={S.sidebar}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em', padding: '4px 6px 8px' }}>플레이어</div>
          {playerList.map(p => (
            <PlayerCard key={p.uid} {...p} showRole={g.status === 'ended' || p.uid === me.uid} />
          ))}
          {spectatorList.length > 0 && (
            <>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.05em', padding: '8px 6px 4px', marginTop: 4 }}>구경꾼</div>
              {spectatorList.map(sp => (
                <div key={sp.uid} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', opacity: 0.4 }}>
                  <Avatar name={sp.name} photoURL={sp.photoURL} size={20} />
                  <span style={{ fontSize: '0.7rem' }}>{sp.name}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Main */}
        <div style={S.main}>
          {g.type === 'mafia' && <MafiaPhaseUI />}
          {g.type === 'wordchain' && <WordchainUI />}

          <div style={S.chatArea}>
            {messages.map(m => <MsgBubble key={m.id} m={m} />)}
            <div ref={bottomRef} />
          </div>

          <div style={S.inputArea}>
            {isSpectator && (
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>👁️</span>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isSpectator ? '구경꾼 채팅...' : '채팅 메시지...'}
              rows={1}
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 13px', color: '#fff', fontSize: '0.875rem', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 100, overflowY: 'auto' }}
            />
            <button onClick={sendMessage} disabled={!input.trim()} style={{ ...S.btn, background: input.trim() ? '#fff' : 'rgba(255,255,255,0.06)', color: input.trim() ? '#000' : 'rgba(255,255,255,0.2)', flexShrink: 0, cursor: input.trim() ? 'pointer' : 'default' }}>전송</button>
          </div>
        </div>
      </div>
    </div>
  )
}
