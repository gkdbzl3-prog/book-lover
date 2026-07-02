import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  db, firebaseReady,
  collection, doc, setDoc, getDoc, onSnapshot, serverTimestamp,
} from "./firebase.js";
import "./App.css";

/* ── 상수 ── */
const AVATARS = ["🐱","🐶","🐰","🐻","🦊","🐼","🐤","🐸","🐧","🦉","🐢","🦆"];
const DEFAULT_BINGO_LABELS = [
  "10페이지","50페이지","100페이지",
  "150페이지","반환점","250페이지",
  "300페이지","마지막 챕터","완독!",
];
const BINGO_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

/* ── 유틸 ── */
function monthKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function nickToUid(n) { return n.trim().toLowerCase(); }
function hasBingo(cells) {
  return BINGO_LINES.some(line => line.every(i => cells[i]));
}
function defaultBook() {
  return {
    title: "", totalPages: 0, currentPage: 0,
    coverDataUrl: "", finished: false,
    isReading: false, sessionStartAt: null, sessionStartPage: 0,
    sessions: [],
  };
}
function readAndCompressImage(file, maxDim = 480, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode-failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width >= height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height > width && height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        try { resolve(canvas.toDataURL("image/jpeg", quality)); } catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── Firebase 경로 ── */
const membersCol = (month) => `bookclub/${month}/members`;
const configDocPath = (month) => `bookclub/${month}/config/main`;

/* ──────────────────────── App ──────────────────────── */
export default function App() {
  const [nickname, setNickname] = useState(() => localStorage.getItem("bc_nickname") || "");
  const [uid, setUid] = useState(() => {
    const n = localStorage.getItem("bc_nickname");
    return n ? nickToUid(n) : "";
  });
  const [avatar, setAvatar] = useState(() => localStorage.getItem("bc_avatar") || AVATARS[0]);
  const [confirmed, setConfirmed] = useState(() => !!localStorage.getItem("bc_nickname"));
  const [nickInput, setNickInput] = useState(nickname);
  const [avatarPick, setAvatarPick] = useState(avatar);

  const monthKey = useMemo(() => monthKeyOf(new Date()), []);
  const [tab, setTab] = useState("reading");

  const [bingoLabels, setBingoLabels] = useState(DEFAULT_BINGO_LABELS);
  const [myBingo, setMyBingo] = useState(new Array(9).fill(false));
  const [myBook, setMyBook] = useState(defaultBook);
  const [members, setMembers] = useState([]);

  const myBingoRef = useRef(myBingo);
  myBingoRef.current = myBingo;
  const myBookRef = useRef(myBook);
  myBookRef.current = myBook;

  /* 닉네임 확정 */
  const confirmNickname = () => {
    const n = nickInput.trim();
    if (!n) return;
    localStorage.setItem("bc_nickname", n);
    localStorage.setItem("bc_avatar", avatarPick);
    setNickname(n); setUid(nickToUid(n)); setAvatar(avatarPick); setConfirmed(true);
  };

  /* 내 데이터 초기 로드 */
  useEffect(() => {
    if (!confirmed || !firebaseReady) return;
    getDoc(doc(db, membersCol(monthKey), uid)).then(snap => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      setMyBingo(Array.isArray(data.bingoCells) ? data.bingoCells : new Array(9).fill(false));
      setMyBook(data.book && typeof data.book === "object" ? { ...defaultBook(), ...data.book } : defaultBook());
    });
  }, [confirmed, monthKey, uid]);

  /* 공유 설정 구독 (빙고 라벨) */
  useEffect(() => {
    if (!confirmed || !firebaseReady) return;
    return onSnapshot(doc(db, configDocPath(monthKey)), snap => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      if (Array.isArray(data.bingoLabels) && data.bingoLabels.length === 9) {
        setBingoLabels(data.bingoLabels);
      }
    });
  }, [confirmed, monthKey]);

  /* 멤버 구독 (나 제외) */
  useEffect(() => {
    if (!confirmed || !firebaseReady) return;
    return onSnapshot(collection(db, membersCol(monthKey)), snap => {
      const all = [];
      snap.forEach(d => {
        if (d.id === uid) return;
        const data = d.data() || {};
        all.push({
          id: d.id,
          nickname: data.nickname || "",
          avatar: data.avatar || "🙂",
          bingoCells: Array.isArray(data.bingoCells) ? data.bingoCells : new Array(9).fill(false),
          book: data.book && typeof data.book === "object" ? { ...defaultBook(), ...data.book } : defaultBook(),
        });
      });
      setMembers(all.sort((a,b) => (a.nickname||"").localeCompare(b.nickname||"","ko")));
    });
  }, [confirmed, monthKey, uid]);

  /* 저장 */
  const save = useCallback((bingo, book) => {
    if (!firebaseReady) return;
    void setDoc(doc(db, membersCol(monthKey), uid), {
      nickname, avatar, bingoCells: bingo, book, updatedAt: serverTimestamp(),
    }).catch(console.error);
  }, [monthKey, uid, nickname, avatar]);

  const toggleBingo = useCallback((idx) => {
    setMyBingo(prev => {
      const next = [...prev];
      next[idx] = !next[idx];
      save(next, myBookRef.current);
      return next;
    });
  }, [save]);

  const updateBook = useCallback((updates) => {
    setMyBook(prev => {
      const next = { ...prev, ...updates };
      save(myBingoRef.current, next);
      return next;
    });
  }, [save]);

  const saveBingoLabels = useCallback((labels) => {
    if (!firebaseReady) return;
    void setDoc(doc(db, configDocPath(monthKey)), { bingoLabels: labels }, { merge: true }).catch(console.error);
  }, [monthKey]);

  const allMembers = useMemo(() => [
    { id: uid, nickname: nickname || "나", avatar, bingoCells: myBingo, book: myBook, mine: true },
    ...members.map(m => ({ ...m, mine: false })),
  ], [uid, nickname, avatar, myBingo, myBook, members]);

  /* 설정 화면 */
  if (!confirmed) {
    return (
      <main className="app">
        <div className="setup">
          <h1 className="brand">book끄lover</h1>
          <p className="setup-sub">BOOK</p>
          <div className="setup-card">
            <label className="setup-label">NICKNAME</label>
            <input className="setup-input" value={nickInput} onChange={e => setNickInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && confirmNickname()} placeholder="닉네임" maxLength={12} />
            <label className="setup-label">AVATAR</label>
            <div className="avatar-grid">
              {AVATARS.map(a => (
                <button key={a} type="button" className={`avatar-opt${avatarPick===a?" on":""}`} onClick={() => setAvatarPick(a)}>{a}</button>
              ))}
            </div>
            <p className="setup-hint">같은 닉네임으로 다른 기기에서도 로그인할 수 있어요</p>
            <button className="setup-btn" type="button" onClick={confirmNickname}>시작하기</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1 className="brand">book끄lover</h1>
        <div className="me">
          <span className="me-avatar">{avatar}</span>
          <span className="me-name">{nickname}</span>
        </div>
      </header>

      <div className="tab-content">
        {tab === "bingo" && (
          <BingoTab
            monthKey={monthKey}
            labels={bingoLabels}
            cells={myBingo}
            onToggle={toggleBingo}
            onLabelsChange={labels => { setBingoLabels(labels); saveBingoLabels(labels); }}
          />
        )}
        {tab === "reading" && (
          <ReadingTab book={myBook} onUpdate={updateBook} />
        )}
        {tab === "members" && (
          <MembersTab members={allMembers} />
        )}
      </div>

      <nav className="tab-nav">
        {[["bingo","빙고"],["reading","독서"],["members","멤버"]].map(([key,label]) => (
          <button key={key} type="button" className={`tab-btn${tab===key?" active":""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
    </main>
  );
}

/* ──────────────────────── 빙고 탭 ──────────────────────── */
function BingoTab({ labels, cells, onToggle, onLabelsChange }) {
  const [editing, setEditing] = useState(false);
  const [editLabels, setEditLabels] = useState(labels);

  useEffect(() => setEditLabels(labels), [labels]);

  const bingo = hasBingo(cells);
  const checkedCount = cells.filter(Boolean).length;
  const month = new Date().toLocaleDateString("ko-KR", { month: "long" });

  const isInBingoLine = (i) =>
    cells[i] && BINGO_LINES.some(line => line.includes(i) && line.every(j => cells[j]));

  return (
    <div className="bingo-tab">
      <div className="bingo-header">
        <span className="bingo-month">{month} 빙고 · {checkedCount}/9</span>
        {bingo && <span className="bingo-badge">빙고!</span>}
        <button type="button" className="edit-btn" onClick={() => setEditing(e => !e)}>
          {editing ? "완료" : "편집"}
        </button>
      </div>

      {editing && (
        <div className="label-editor">
          {editLabels.map((label, i) => (
            <input key={i} className="label-input" value={label}
              onChange={e => {
                const next = [...editLabels];
                next[i] = e.target.value;
                setEditLabels(next);
                onLabelsChange(next);
              }}
              placeholder={`칸 ${i+1}`} maxLength={10} />
          ))}
        </div>
      )}

      <div className="bingo-grid">
        {cells.map((checked, i) => (
          <button key={i} type="button"
            className={`bingo-cell${checked?" checked":""}${isInBingoLine(i)?" line":""}`}
            onClick={() => onToggle(i)}>
            {checked && <span className="bingo-check">✓</span>}
            <span className="bingo-label">{labels[i] || `${i+1}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────── 독서 탭 ──────────────────────── */
function ReadingTab({ book, onUpdate }) {
  const [elapsed, setElapsed] = useState(0);
  const [pageInput, setPageInput] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [setupTitle, setSetupTitle] = useState("");
  const [setupPages, setSetupPages] = useState("");
  const coverInputRef = useRef(null);

  useEffect(() => {
    setPageInput(book.currentPage > 0 ? String(book.currentPage) : "");
  }, [book.currentPage]);

  /* 타이머 */
  useEffect(() => {
    if (!book.isReading || !book.sessionStartAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Date.now() - book.sessionStartAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [book.isReading, book.sessionStartAt]);

  const percent = book.totalPages > 0 ? Math.min(100, (book.currentPage / book.totalPages) * 100) : 0;

  function handlePageBlur() {
    const p = parseInt(pageInput, 10);
    if (isNaN(p) || p < 0) return;
    const finished = book.totalPages > 0 && p >= book.totalPages;
    onUpdate({ currentPage: p, finished });
  }

  function handleTimerToggle() {
    if (!book.isReading) {
      onUpdate({ isReading: true, sessionStartAt: Date.now(), sessionStartPage: book.currentPage });
    } else {
      const endPage = parseInt(pageInput, 10) || book.currentPage;
      const durationMs = Date.now() - (book.sessionStartAt || Date.now());
      const session = {
        startAt: book.sessionStartAt,
        endAt: Date.now(),
        startPage: book.sessionStartPage,
        endPage,
        pagesRead: Math.max(0, endPage - book.sessionStartPage),
        durationMs,
      };
      const finished = book.totalPages > 0 && endPage >= book.totalPages;
      onUpdate({
        isReading: false, sessionStartAt: null, sessionStartPage: 0,
        currentPage: endPage, finished,
        sessions: [session, ...(book.sessions || [])].slice(0, 20),
      });
    }
  }

  function handleSetup() {
    const title = setupTitle.trim();
    const totalPages = parseInt(setupPages, 10);
    if (!title || !totalPages || totalPages < 1) return;
    onUpdate({ ...defaultBook(), title, totalPages });
    setShowSetup(false);
  }

  function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readAndCompressImage(file).then(dataUrl => onUpdate({ coverDataUrl: dataUrl })).catch(console.error);
    e.target.value = "";
  }

  function formatElapsed(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m%60).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  }

  function formatSession(s) {
    const d = new Date(s.startAt);
    const date = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`;
    const min = Math.round(s.durationMs / 60000);
    return `${date} · ${min}분 · +${s.pagesRead}p`;
  }

  /* 책 없음 or 설정 중 */
  if (!book.title || showSetup) {
    return (
      <div className="reading-tab">
        <div className="book-setup-card">
          <h2 className="section-title">{book.title ? "책 변경" : "이번 달 책"}</h2>
          <input className="setup-input" value={setupTitle} onChange={e => setSetupTitle(e.target.value)}
            placeholder="책 제목" />
          <input className="setup-input" type="number" value={setupPages}
            onChange={e => setSetupPages(e.target.value)} placeholder="전체 페이지 수" min={1} />
          {book.title && (
            <button type="button" className="cancel-btn" onClick={() => setShowSetup(false)}>취소</button>
          )}
          <button type="button" className="setup-btn" onClick={handleSetup}>
            {book.title ? "변경" : "시작"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reading-tab">
      {/* 프로그레스 */}
      <div className="progress-section">
        <div className="progress-circle-wrap">
          <CircleProgress percent={percent} coverUrl={book.coverDataUrl} finished={book.finished} />
          <button type="button" className="cover-btn" onClick={() => coverInputRef.current?.click()}>
            {book.coverDataUrl ? "표지 변경" : "표지 추가"}
          </button>
          <input ref={coverInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleCoverUpload} />
        </div>

        <div className="progress-info">
          <div className="book-title-text">{book.title}</div>
          {book.finished ? (
            <div className="finished-badge">완독 🎉</div>
          ) : (
            <>
              <div className="page-count">{book.currentPage} / {book.totalPages}p</div>
              <div className="percent-text">{Math.round(percent)}%</div>
            </>
          )}
        </div>
      </div>

      {/* 현재 쪽수 입력 */}
      {!book.finished && (
        <div className="page-input-row">
          <label className="page-label">현재 쪽수</label>
          <input className="page-input" type="number" value={pageInput}
            onChange={e => setPageInput(e.target.value)}
            onBlur={handlePageBlur}
            onKeyDown={e => e.key === "Enter" && handlePageBlur()}
            min={0} max={book.totalPages} />
          <span className="page-total">/ {book.totalPages}</span>
        </div>
      )}

      {/* 타이머 버튼 */}
      {!book.finished && (
        <button type="button" className={`timer-btn${book.isReading?" active":""}`} onClick={handleTimerToggle}>
          {book.isReading
            ? `■ 읽는 중 · ${formatElapsed(elapsed)} · 중지`
            : "● 읽기 시작"}
        </button>
      )}

      <button type="button" className="change-book-btn" onClick={() => { setSetupTitle(book.title); setSetupPages(String(book.totalPages)); setShowSetup(true); }}>
        책 변경
      </button>

      {/* 세션 기록 */}
      {book.sessions?.length > 0 && (
        <div className="sessions">
          <h3 className="sessions-title">독서 세션</h3>
          {book.sessions.map((s, i) => (
            <div key={i} className="session-item">{formatSession(s)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────── 멤버 탭 ──────────────────────── */
function MembersTab({ members }) {
  return (
    <div className="members-tab">
      {members.map(m => {
        const percent = m.book.totalPages > 0
          ? Math.min(100, (m.book.currentPage / m.book.totalPages) * 100) : 0;
        const bingoCount = m.bingoCells.filter(Boolean).length;
        const bingo = hasBingo(m.bingoCells);
        return (
          <div key={m.id} className={`member-card${m.mine?" mine-card":""}`}>
            <SmallCircleProgress
              percent={percent}
              coverUrl={m.book.coverDataUrl}
              finished={m.book.finished}
            />
            <div className="mc-info">
              <div className="mc-top">
                <span className="mc-avatar">{m.avatar}</span>
                <span className="mc-name">{m.nickname}{m.mine?" (나)":""}</span>
                {bingo && <span className="mc-bingo-badge">빙고</span>}
              </div>
              {m.book.title && (
                <div className="mc-book">
                  {m.book.finished
                    ? <><span className="mc-done-icon">✓</span> {m.book.title}</>
                    : <>{m.book.title} · {Math.round(percent)}%</>}
                </div>
              )}
              <div className="mc-bingo-bar">
                {m.bingoCells.map((c, i) => (
                  <div key={i} className={`mc-bingo-dot${c?" on":""}`} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────── 원형 프로그레스 ──────────────────────── */
function CircleProgress({ percent, coverUrl, finished, size = 180 }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  const cx = size / 2, cy = size / 2;

  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ position:"absolute", inset:0 }}>
        <defs>
          <linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={finished ? "#4ade80" : "#a78bfa"} />
            <stop offset="100%" stopColor={finished ? "#22d3ee" : "#fb923c"} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        {percent > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="url(#pg)" strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`} />
        )}
      </svg>
      <div style={{
        position:"absolute", inset:stroke+4, borderRadius:"50%",
        overflow:"hidden", background:"rgba(255,255,255,0.04)",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        {coverUrl
          ? <img src={coverUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
          : <span style={{ fontSize:40, opacity:0.3 }}>📖</span>}
      </div>
    </div>
  );
}

function SmallCircleProgress({ percent, coverUrl, finished, size = 64 }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  const cx = size / 2, cy = size / 2;

  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ position:"absolute", inset:0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        {percent > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={finished ? "#4ade80" : "#a78bfa"} strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`} />
        )}
      </svg>
      <div style={{
        position:"absolute", inset:stroke+2, borderRadius:"50%",
        overflow:"hidden", background:"rgba(255,255,255,0.04)",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        {coverUrl
          ? <img src={coverUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
          : <span style={{ fontSize:18, opacity:0.3 }}>📖</span>}
      </div>
    </div>
  );
}
