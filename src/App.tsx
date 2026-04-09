import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import packageMetadata from '../package.json'
import brandIcon from '../design/blindly icon.png'
import { InventoryView } from './inventory'
import { PerformanceView } from './performance'
import { ClearableInput } from './ClearableInput'
import './App.css'

type RouteKey =
  | 'session-new'
  | 'session-active'
  | 'session-report'
  | 'inventory'
  | 'imports'
  | 'performance'
  | 'settings'

type RouteDefinition = {
  key: Exclude<RouteKey, 'session-active' | 'session-report'>
  label: string
  route: string
}

type BootstrapStatus = {
  dbPath: string
  schemaVersion: number
  tableCount: number
}

type DatabaseBackupMetadata = {
  path: string
  fileSizeBytes: number
  schemaVersion: number
  tableCount: number
}

type DatabaseBackupExportResult = {
  backup: DatabaseBackupMetadata
  databasePath: string
}

type DatabaseBackupRestoreResult = {
  restoredBackup: DatabaseBackupMetadata
  databasePath: string
  previousDatabaseBackupPath: string | null
}

type SessionStartResult = {
  sessionId: string
  targetBatchSize: number
  startedAt: string
}

type BottleCodeValidationResult = {
  code: number
  status: 'valid' | 'invalid'
}

type MaterialSearchItem = {
  id: string
  name: string
  status: 'active' | 'archived'
}

type MaterialSearchResult = {
  results: MaterialSearchItem[]
}

type ImportIssue = {
  row: number
  message: string
}

type MaterialsImportSummary = {
  rowsRead: number
  creates: number
  duplicatesSkipped: number
  errors: ImportIssue[]
  committed: boolean
}

type BottlesImportSummary = {
  mode: string
  rowsRead: number
  createMaterials: number
  createBottles: number
  updateBottles: number
  errors: ImportIssue[]
  committed: boolean
}

type BottlesImportMode = 'append_only' | 'upsert_by_code'

type SessionNoteResult = {
  sessionId: string
  sessionNote: string | null
  updatedAt: string
}

type SessionEntry = {
  sequence: number
  code: number | null
  guessedMaterial: MaterialSearchItem | null
  preRevealNote: string
  skipped: boolean
}

type SessionReportRow = {
  sequence: number
  code: number | null
  guessedMaterialName: string | null
  trueMaterialName: string
  status: 'match' | 'mismatch' | 'skipped'
  note: string
  revealedAt: string | null
}

type SessionReport = {
  rows: SessionReportRow[]
  correctCount: number
  guessedCount: number
  skippedCount: number
  completedAt: string
}

type SessionEntryPayload = {
  sequence: number
  code: number | null
  guessedMaterialId: string | null
  preRevealNote: string | null
  skipped: boolean
}

const routes: RouteDefinition[] = [
  { key: 'session-new', label: 'NEW SESSION', route: '/session/new' },
  { key: 'inventory', label: 'INVENTORY', route: '/inventory' },
  { key: 'performance', label: 'PERFORMANCE', route: '/performance' },
  { key: 'settings', label: 'SETTINGS', route: '/settings' },
]

const sessionBatchSizes = [
  { value: 5, duration: '~15 MIN', difficulty: 'LOW', unitId: 'BTL_05' },
  { value: 10, duration: '~30 MIN', difficulty: 'MEDIUM', unitId: 'BTL_10' },
  { value: 15, duration: '~45 MIN', difficulty: 'HIGH', unitId: 'BTL_15' },
]

const numberFormatter = new Intl.NumberFormat()
const appVersionLabel = `V.${packageMetadata.version}`
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

type AppProps = {
  onReady?: () => void
}

function App({ onReady }: AppProps) {
  const hasTauriRuntime = '__TAURI_INTERNALS__' in window
  const hasReportedReady = useRef(false)
  const [currentRoute, setCurrentRoute] = useState<RouteKey>('session-new')
  const [selectedBatchSize, setSelectedBatchSize] = useState<number>(10)
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(
    null,
  )
  const [bootstrapError, setBootstrapError] = useState<string | null>(
    hasTauriRuntime
      ? null
      : 'Tauri runtime not detected. Run `npm run tauri:dev` to use the desktop flow.',
  )
  const [createdSession, setCreatedSession] = useState<SessionStartResult | null>(
    null,
  )
  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([])
  const [sessionReport, setSessionReport] = useState<SessionReport | null>(null)
  const [sessionNote, setSessionNote] = useState('')
  const [sessionElapsedTime, setSessionElapsedTime] = useState('00:00:00')
  const [sessionStartError, setSessionStartError] = useState<string | null>(null)
  const [sessionFinalizeError, setSessionFinalizeError] = useState<string | null>(
    null,
  )
  const [sessionNoteError, setSessionNoteError] = useState<string | null>(null)
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [isFinalizingSession, setIsFinalizingSession] = useState(false)
  const [isSavingSessionNote, setIsSavingSessionNote] = useState(false)
  const [pendingRoute, setPendingRoute] = useState<RouteKey | null>(null)

  async function refreshBootstrapStatus() {
    if (!hasTauriRuntime) {
      return
    }

    try {
      const status = await invoke<BootstrapStatus>('get_bootstrap_status')
      setBootstrapStatus(status)
      setBootstrapError(null)
    } catch (error) {
      setBootstrapStatus(null)
      setBootstrapError(String(error))
    }
  }

  useEffect(() => {
    const reportReady = () => {
      if (hasReportedReady.current) {
        return
      }

      hasReportedReady.current = true
      onReady?.()
    }

    if (!hasTauriRuntime) {
      reportReady()
      return
    }

    invoke<BootstrapStatus>('get_bootstrap_status')
      .then((status) => {
        setBootstrapStatus(status)
        setBootstrapError(null)
      })
      .catch((error) => {
        setBootstrapStatus(null)
        setBootstrapError(String(error))
      })
      .finally(() => {
        reportReady()
      })
  }, [hasTauriRuntime, onReady])

  useEffect(() => {
    if (!createdSession || currentRoute !== 'session-active') {
      setSessionElapsedTime('00:00:00')
      return
    }

    const tick = () => {
      setSessionElapsedTime(formatElapsedTime(createdSession.startedAt))
    }

    tick()
    const intervalId = window.setInterval(tick, 1000)
    return () => window.clearInterval(intervalId)
  }, [createdSession, currentRoute])

  const hasOngoingSession = currentRoute === 'session-active' && createdSession !== null

  useEffect(() => {
    if (!hasOngoingSession) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasOngoingSession])

  function resetSessionFlow(targetRoute: RouteKey = 'session-new') {
    setCreatedSession(null)
    setSessionEntries([])
    setSessionReport(null)
    setSessionNote('')
    setSessionStartError(null)
    setSessionFinalizeError(null)
    setSessionNoteError(null)
    setPendingRoute(null)
    setCurrentRoute(targetRoute)
  }

  function requestRouteChange(nextRoute: RouteKey) {
    if (nextRoute === currentRoute) {
      return
    }

    if (hasOngoingSession && nextRoute !== 'session-report') {
      setPendingRoute(nextRoute)
      return
    }

    setCurrentRoute(nextRoute)
  }

  async function handleStartSession() {
    if (!hasTauriRuntime) {
      setSessionStartError(
        'Session creation is only available inside the Tauri desktop runtime.',
      )
      return
    }

    setIsStartingSession(true)
    setSessionStartError(null)
    setSessionFinalizeError(null)

    try {
      const session = await invoke<SessionStartResult>('start_session', {
        targetBatchSize: selectedBatchSize,
      })

      setCreatedSession(session)
      setSessionEntries([])
      setSessionReport(null)
      setSessionNote('')
      setCurrentRoute('session-active')
    } catch (error) {
      setSessionStartError(String(error))
    } finally {
      setIsStartingSession(false)
    }
  }

  async function finalizeSession(entries: SessionEntry[]) {
    if (!hasTauriRuntime || !createdSession) {
      setSessionFinalizeError(
        'Session finalization is only available inside the Tauri desktop runtime.',
      )
      return
    }

    setIsFinalizingSession(true)
    setSessionFinalizeError(null)

    try {
      const sessionReport = await invoke<SessionReport>('complete_session', {
        sessionId: createdSession.sessionId,
        entries: entries.map<SessionEntryPayload>((entry) => ({
          sequence: entry.sequence,
          code: entry.code,
          guessedMaterialId: entry.guessedMaterial?.id ?? null,
          preRevealNote: entry.preRevealNote.trim() || null,
          skipped: entry.skipped,
        })),
      })

      setSessionEntries(entries)
      setSessionReport(sessionReport)
      setCurrentRoute('session-report')
    } catch (error) {
      setSessionFinalizeError(String(error))
    } finally {
      setIsFinalizingSession(false)
    }
  }

  const activeNavKey: RouteDefinition['key'] =
    currentRoute === 'session-active' || currentRoute === 'session-report'
      ? 'session-new'
      : currentRoute

  const sidebarStatus = getSidebarStatus({
    currentRoute,
    createdSession,
    sessionElapsedTime,
    sessionReport,
  })

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img alt="" aria-hidden="true" className="brand-mark" src={brandIcon} />
          <div>
            <h1>BLINDLY</h1>
            <p className="sidebar-kicker">{appVersionLabel}</p>
          </div>
        </div>

        <nav aria-label="Primary" className="sidebar-nav">
          {routes.map((route) => (
            <button
              key={route.key}
              aria-current={route.key === activeNavKey ? 'page' : undefined}
              className={`sidebar-link${route.key === activeNavKey ? ' is-active' : ''}`}
              onClick={() => requestRouteChange(route.key)}
              type="button"
            >
              <span className="sidebar-link-label">{route.route.toUpperCase()}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <p className="panel-label">SYSTEM STATUS</p>
          <div className="status-row">
            <span className="status-dot" aria-hidden="true" />
            <span>{sidebarStatus.title}</span>
          </div>
          <p
            className={`sidebar-copy${
              sidebarStatus.emphasis === 'timer' ? ' sidebar-copy-timer' : ''
            }`}
          >
            {sidebarStatus.detail}
          </p>
          {!bootstrapStatus && bootstrapError ? (
            <p className="sidebar-copy sidebar-copy-muted">{bootstrapError}</p>
          ) : null}
        </div>
      </aside>

      <main className="workspace">
        <RouteView
          bootstrapError={bootstrapError}
          bootstrapStatus={bootstrapStatus}
          createdSession={createdSession}
          currentRoute={currentRoute}
          hasTauriRuntime={hasTauriRuntime}
          isFinalizingSession={isFinalizingSession}
          isSavingSessionNote={isSavingSessionNote}
          isStartingSession={isStartingSession}
          selectedBatchSize={selectedBatchSize}
          sessionEntries={sessionEntries}
          sessionFinalizeError={sessionFinalizeError}
          sessionNote={sessionNote}
          sessionNoteError={sessionNoteError}
          sessionReport={sessionReport}
          sessionStartError={sessionStartError}
          refreshBootstrapStatus={refreshBootstrapStatus}
          setCurrentRoute={requestRouteChange}
          setSelectedBatchSize={setSelectedBatchSize}
          setSessionNote={setSessionNote}
          startSession={handleStartSession}
          finalizeSession={finalizeSession}
          resetSessionFlow={resetSessionFlow}
          setSessionEntries={setSessionEntries}
          saveSessionNote={async () => {
            if (!hasTauriRuntime || !createdSession) {
              return
            }

            setIsSavingSessionNote(true)
            setSessionNoteError(null)

            try {
              const result = await invoke<SessionNoteResult>('update_session_note', {
                sessionId: createdSession.sessionId,
                sessionNote: sessionNote,
              })
              setSessionNote(result.sessionNote ?? '')
            } catch (error) {
              setSessionNoteError(String(error))
            } finally {
              setIsSavingSessionNote(false)
            }
          }}
        />

        {pendingRoute ? (
          <div
            aria-labelledby="discard-session-title"
            aria-modal="true"
            className="modal-overlay"
            role="dialog"
          >
            <div className="modal-panel">
              <p className="panel-label accent-copy">ONGOING SESSION</p>
              <h2 id="discard-session-title" className="modal-title">
                DISCARD CURRENT SESSION?
              </h2>
              <p className="sidebar-copy">
                The current evaluation run is still active. Continue the session or
                discard it before leaving this screen.
              </p>
              <div className="modal-actions">
                <button
                  className="secondary-action"
                  onClick={() => setPendingRoute(null)}
                  type="button"
                >
                  CONTINUE
                </button>
                <button
                  className="primary-action"
                  onClick={() => resetSessionFlow(pendingRoute)}
                  type="button"
                >
                  DISCARD
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

type RouteViewProps = {
  bootstrapError: string | null
  bootstrapStatus: BootstrapStatus | null
  createdSession: SessionStartResult | null
  currentRoute: RouteKey
  hasTauriRuntime: boolean
  isFinalizingSession: boolean
  isSavingSessionNote: boolean
  isStartingSession: boolean
  selectedBatchSize: number
  sessionEntries: SessionEntry[]
  sessionFinalizeError: string | null
  sessionNote: string
  sessionNoteError: string | null
  sessionReport: SessionReport | null
  sessionStartError: string | null
  refreshBootstrapStatus: () => Promise<void>
  setCurrentRoute: (route: RouteKey) => void
  setSelectedBatchSize: (value: number) => void
  setSessionNote: (value: string) => void
  startSession: () => Promise<void>
  finalizeSession: (entries: SessionEntry[]) => Promise<void>
  resetSessionFlow: () => void
  setSessionEntries: (entries: SessionEntry[]) => void
  saveSessionNote: () => Promise<void>
}

function RouteView({
  bootstrapError,
  bootstrapStatus,
  createdSession,
  currentRoute,
  hasTauriRuntime,
  isFinalizingSession,
  isSavingSessionNote,
  isStartingSession,
  selectedBatchSize,
  sessionEntries,
  sessionFinalizeError,
  sessionNote,
  sessionNoteError,
  sessionReport,
  sessionStartError,
  refreshBootstrapStatus,
  setCurrentRoute,
  setSelectedBatchSize,
  setSessionNote,
  startSession,
  finalizeSession,
  resetSessionFlow,
  setSessionEntries,
  saveSessionNote,
}: RouteViewProps) {
  switch (currentRoute) {
    case 'session-new':
      return (
        <SessionSetupView
          hasTauriRuntime={hasTauriRuntime}
          isStartingSession={isStartingSession}
          selectedBatchSize={selectedBatchSize}
          sessionStartError={sessionStartError}
          setSelectedBatchSize={setSelectedBatchSize}
          startSession={startSession}
        />
      )
    case 'session-active':
      return (
        <ActiveSessionView
          createdSession={createdSession}
          entries={sessionEntries}
          finalizeSession={finalizeSession}
          hasTauriRuntime={hasTauriRuntime}
          isFinalizingSession={isFinalizingSession}
          selectedBatchSize={selectedBatchSize}
          sessionFinalizeError={sessionFinalizeError}
          setCurrentRoute={setCurrentRoute}
          setEntries={setSessionEntries}
        />
      )
    case 'session-report':
      return (
        <SessionReportView
          createdSession={createdSession}
          isSavingSessionNote={isSavingSessionNote}
          report={sessionReport}
          resetSessionFlow={resetSessionFlow}
          saveSessionNote={saveSessionNote}
          sessionNote={sessionNote}
          sessionNoteError={sessionNoteError}
          setSessionNote={setSessionNote}
        />
      )
    case 'inventory':
      return <InventoryView hasTauriRuntime={hasTauriRuntime} />
    case 'imports':
      return <ImportsView hasTauriRuntime={hasTauriRuntime} />
    case 'performance':
      return <PerformanceView hasTauriRuntime={hasTauriRuntime} />
    case 'settings':
      return (
        <SettingsView
          bootstrapError={bootstrapError}
          bootstrapStatus={bootstrapStatus}
          hasTauriRuntime={hasTauriRuntime}
          refreshBootstrapStatus={refreshBootstrapStatus}
        />
      )
  }
}

type SessionSetupViewProps = {
  hasTauriRuntime: boolean
  isStartingSession: boolean
  selectedBatchSize: number
  sessionStartError: string | null
  setSelectedBatchSize: (value: number) => void
  startSession: () => Promise<void>
}

function SessionSetupView({
  hasTauriRuntime,
  isStartingSession,
  selectedBatchSize,
  sessionStartError,
  setSelectedBatchSize,
  startSession,
}: SessionSetupViewProps) {
  return (
    <section className="session-screen">
      <header className="session-header">
        <div className="route-heading-group">
          <p className="panel-label accent-copy">SESSION CONFIGURATION</p>
          <h2 className="session-title">01_SESSION_START</h2>
        </div>
        <div className="session-meta-strip" aria-label="Session setup status">
          <span>STATUS: {hasTauriRuntime ? 'READY' : 'PREVIEW'}</span>
          <span>LOADOUT: {selectedBatchSize}</span>
        </div>
      </header>

      <div className="loadout-grid">
        {sessionBatchSizes.map((option) => {
          const isSelected = option.value === selectedBatchSize

          return (
            <button
              key={option.value}
              className={`loadout-card${isSelected ? ' is-selected' : ''}`}
              onClick={() => setSelectedBatchSize(option.value)}
              type="button"
            >
              <div className="loadout-id">ID: {option.unitId}</div>
              <div className="loadout-value">{option.value}</div>
              <div className="loadout-label">UNIT_CAPACITY</div>
              <dl className="loadout-stats">
                <div>
                  <dt>DURATION_EST</dt>
                  <dd>{option.duration}</dd>
                </div>
                <div>
                  <dt>COMPLEXITY_LVL</dt>
                  <dd>{option.difficulty}</dd>
                </div>
              </dl>
            </button>
          )
        })}
      </div>

      <div className="setup-action-panel">
        <div>
          <h3>SEQUENCE_CONFIRMATION</h3>
          <p className="sidebar-copy">
            System will initialize blind identification protocol for{' '}
            <span className="accent-copy">{selectedBatchSize} units</span>. Bottle
            answers remain hidden during capture and resolve only in the final report.
          </p>
          {sessionStartError ? <p className="status-error">{sessionStartError}</p> : null}
        </div>
        <button
          className="primary-action primary-action-large"
          disabled={isStartingSession}
          onClick={() => {
            void startSession()
          }}
          type="button"
        >
          {isStartingSession ? (
            <span className="action-inline">
              <span aria-hidden="true" className="spinner" />
              <span>START SESSION</span>
            </span>
          ) : (
            'START SESSION'
          )}
        </button>
      </div>

    </section>
  )
}

type ActiveSessionViewProps = {
  createdSession: SessionStartResult | null
  entries: SessionEntry[]
  finalizeSession: (entries: SessionEntry[]) => Promise<void>
  hasTauriRuntime: boolean
  isFinalizingSession: boolean
  selectedBatchSize: number
  sessionFinalizeError: string | null
  setCurrentRoute: (route: RouteKey) => void
  setEntries: (entries: SessionEntry[]) => void
}

function ActiveSessionView({
  createdSession,
  entries,
  finalizeSession,
  hasTauriRuntime,
  isFinalizingSession,
  selectedBatchSize,
  sessionFinalizeError,
  setCurrentRoute,
  setEntries,
}: ActiveSessionViewProps) {
  const [codeInput, setCodeInput] = useState('')
  const [validatedCode, setValidatedCode] =
    useState<BottleCodeValidationResult | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isValidatingCode, setIsValidatingCode] = useState(false)
  const [materialQuery, setMaterialQuery] = useState('')
  const [materialResults, setMaterialResults] = useState<MaterialSearchItem[]>([])
  const [materialSearchError, setMaterialSearchError] = useState<string | null>(null)
  const [isSearchingMaterials, setIsSearchingMaterials] = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialSearchItem | null>(
    null,
  )
  const [preRevealNote, setPreRevealNote] = useState('')
  const [flowError, setFlowError] = useState<string | null>(null)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [editingEntrySequence, setEditingEntrySequence] = useState<number | null>(null)
  const bottleCodeInputRef = useRef<HTMLInputElement | null>(null)
  const sessionTarget = createdSession?.targetBatchSize ?? selectedBatchSize
  const currentStep =
    editingEntrySequence ?? Math.min(entries.length + 1, sessionTarget)
  const isLastBottle =
    editingEntrySequence === null && entries.length + 1 >= sessionTarget
  const capturedCodes = new Set(
    entries.flatMap((entry) =>
      entry.sequence === editingEntrySequence || entry.code === null ? [] : [entry.code],
    ),
  )

  useEffect(() => {
    if (!hasTauriRuntime) {
      return
    }

    let isCancelled = false
    const trimmedQuery = materialQuery.trim()

    if (!trimmedQuery) {
      setMaterialResults([])
      setMaterialSearchError(null)
      setIsSearchingMaterials(false)
      return
    }

    setIsSearchingMaterials(true)
    setMaterialSearchError(null)

    invoke<MaterialSearchResult>('search_materials', {
      query: trimmedQuery,
      limit: 6,
    })
      .then((result) => {
        if (!isCancelled) {
          setMaterialResults(result.results)
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setMaterialResults([])
          setMaterialSearchError(String(error))
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsSearchingMaterials(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [hasTauriRuntime, materialQuery])

  useEffect(() => {
    if (editingEntrySequence !== null) {
      return
    }

    const input = bottleCodeInputRef.current
    if (!input) {
      return
    }

    input.focus()
    input.select()
  }, [editingEntrySequence])

  function focusBottleCodeInput() {
    window.requestAnimationFrame(() => {
      const input = bottleCodeInputRef.current
      if (!input) {
        return
      }

      input.focus()
      input.select()
    })
  }

  function resetCurrentBottle() {
    setCodeInput('')
    setValidatedCode(null)
    setCodeError(null)
    setMaterialQuery('')
    setMaterialResults([])
    setMaterialSearchError(null)
    setSelectedMaterial(null)
    setPreRevealNote('')
    setFlowError(null)
    setEditingEntrySequence(null)
    focusBottleCodeInput()
  }

  function beginEditingEntry(entry: SessionEntry) {
    setEditingEntrySequence(entry.sequence)
    setCodeInput(entry.code === null ? '' : String(entry.code))
    setValidatedCode(
      entry.code === null
        ? null
        : {
            code: entry.code,
            status: 'valid',
          },
    )
    setCodeError(null)
    setMaterialQuery(entry.guessedMaterial?.name ?? '')
    setMaterialResults(entry.guessedMaterial ? [entry.guessedMaterial] : [])
    setMaterialSearchError(null)
    setSelectedMaterial(entry.guessedMaterial)
    setPreRevealNote(entry.preRevealNote)
    setFlowError(null)
  }

  async function handleValidateCode() {
    if (!hasTauriRuntime) {
      setCodeError('Bottle-code validation is only available in the desktop runtime.')
      return
    }

    const parsedCode = Number.parseInt(codeInput, 10)
    if (Number.isNaN(parsedCode)) {
      setValidatedCode(null)
      setCodeError('Enter a valid 3-digit numeric code.')
      return
    }

    setIsValidatingCode(true)
    setCodeError(null)
    setFlowError(null)

    try {
      const result = await invoke<BottleCodeValidationResult>('validate_bottle_code', {
        code: parsedCode,
      })

      setValidatedCode(result)
      if (result.status !== 'valid') {
        setCodeError('Code not found in active bottles.')
      } else if (capturedCodes.has(result.code)) {
        setCodeError('This bottle code is already queued in the current session.')
      }
    } catch (error) {
      setValidatedCode(null)
      setCodeError(String(error))
    } finally {
      setIsValidatingCode(false)
    }
  }

  async function handleAdvance(mode: 'guess' | 'skip') {
    if (isAdvancing || isFinalizingSession) {
      return
    }

    if (!createdSession) {
      setFlowError('Active session context is missing.')
      return
    }

    if (entries.length >= sessionTarget) {
      setFlowError('This session has already reached its selected batch size.')
      return
    }

    if (mode === 'guess' && (!validatedCode || validatedCode.status !== 'valid')) {
      setFlowError('Validate a bottle code before continuing.')
      return
    }

    if (mode === 'guess' && !selectedMaterial) {
      setFlowError('Select a guessed material before continuing.')
      return
    }

    if (
      validatedCode &&
      validatedCode.status === 'valid' &&
      capturedCodes.has(validatedCode.code)
    ) {
      setFlowError('This bottle code is already queued in the current session.')
      return
    }

    setIsAdvancing(true)

    try {
      const nextEntry: SessionEntry = {
        sequence: editingEntrySequence ?? entries.length + 1,
        code:
          mode === 'skip' && validatedCode?.status === 'valid'
            ? validatedCode.code
            : mode === 'skip'
              ? null
              : validatedCode!.code,
        guessedMaterial: mode === 'skip' ? null : selectedMaterial,
        preRevealNote: preRevealNote.trim(),
        skipped: mode === 'skip',
      }

      const updatedEntries =
        editingEntrySequence === null
          ? [...entries, nextEntry]
          : entries.map((entry) =>
              entry.sequence === editingEntrySequence ? nextEntry : entry,
            )
      setEntries(updatedEntries)

      if (editingEntrySequence === null && updatedEntries.length >= sessionTarget) {
        await finalizeSession(updatedEntries)
        return
      }

      resetCurrentBottle()
    } finally {
      setIsAdvancing(false)
    }
  }

  if (!createdSession) {
    return (
      <EmptySessionState
        copy="No active session is currently loaded. Start from the session setup screen to begin a queued evaluation run."
        ctaLabel="RETURN TO SETUP"
        onClick={() => setCurrentRoute('session-new')}
      />
    )
  }

  return (
    <section className="session-screen session-screen-evaluation">
      <div className="evaluation-shell">
        <div className="progress-header">
          <div>
            <h3>EVALUATION</h3>
            <p className="sidebar-copy">Blind testing sequence in progress</p>
          </div>
          <div className="progress-count">
            <span className="panel-label">BOTTLE</span>
            <div>
              <span className="accent-copy">{String(currentStep).padStart(2, '0')}</span>
              <span className="progress-divider">/</span>
              <span>{String(sessionTarget).padStart(2, '0')}</span>
            </div>
          </div>
        </div>

        <div className="evaluation-grid">
          <section className="evaluation-column">
            <article className="instrument-panel instrument-panel-primary">
              <label className="panel-label" htmlFor="bottle-code">
                BOTTLE REFERENCE CODE
              </label>
              <label className="digit-entry-shell" htmlFor="bottle-code">
                <span className="sr-only">Enter bottle reference code</span>
                <div className="digit-strip" aria-hidden="true">
                  {renderCodeDigits(codeInput).map((digit, index) => (
                    <div key={`${digit}-${index}`} className="digit-cell">
                      <span>{digit}</span>
                    </div>
                  ))}
                </div>
                <input
                  id="bottle-code"
                  autoFocus
                  autoComplete="off"
                  className="digit-overlay-input"
                  inputMode="numeric"
                  maxLength={3}
                  name="bottleCode"
                  ref={bottleCodeInputRef}
                  onFocus={(event) => {
                    event.currentTarget.select()
                  }}
                  onPointerUp={(event) => {
                    event.preventDefault()
                    event.currentTarget.focus()
                    event.currentTarget.select()
                  }}
                  onChange={(event) => {
                    const digitsOnly = event.target.value.replace(/\D+/g, '').slice(0, 3)
                    setCodeInput(digitsOnly)
                    setValidatedCode(null)
                    setCodeError(null)
                    setFlowError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleValidateCode()
                    }
                  }}
                  placeholder="000"
                  spellCheck={false}
                  type="text"
                  value={codeInput}
                />
              </label>
              <div className="code-entry-row">
                <button
                  className="secondary-action secondary-action-wide"
                  disabled={isValidatingCode || isFinalizingSession}
                  onClick={() => {
                    void handleValidateCode()
                  }}
                  type="button"
                >
                  {isValidatingCode ? (
                    <span className="action-inline">
                      <span aria-hidden="true" className="spinner spinner-secondary" />
                      <span>VERIFY</span>
                    </span>
                  ) : (
                    <span className="action-inline">
                      <span>VERIFY</span>
                      <span className="material-symbols-outlined" aria-hidden="true">
                        task_alt
                      </span>
                    </span>
                  )}
                </button>
              </div>
              <div className="instrument-status-row">
                <span>INPUT 3-DIGIT NUMERIC TAG</span>
                <span>
                  VERIFIED STATUS:{' '}
                  {validatedCode?.status === 'valid' ? 'ACTIVE' : 'PENDING'}
                </span>
              </div>
              {codeError ? <p className="status-error">{codeError}</p> : null}
            </article>

            <article className="instrument-panel instrument-panel-secondary">
              <label className="panel-label" htmlFor="material-query">
                YOUR GUESS [MATERIAL LIBRARY]
              </label>
              <ClearableInput
                id="material-query"
                className="text-input tactical-input"
                clearLabel="Clear material guess search"
                name="materialQuery"
                onChange={(value) => {
                  setMaterialQuery(value)
                  setSelectedMaterial(null)
                  setFlowError(null)
                }}
                placeholder="Search materials…"
                value={materialQuery}
              />
              <div className="chip-grid" role="list" aria-label="Material results">
                {materialResults.map((material) => (
                  <button
                    key={material.id}
                    className={`chip-button${
                      selectedMaterial?.id === material.id ? ' is-selected' : ''
                    }`}
                    onClick={() => setSelectedMaterial(material)}
                    type="button"
                  >
                    {material.name}
                  </button>
                ))}
              </div>
              {!isSearchingMaterials &&
              materialQuery.trim().length > 0 &&
              materialResults.length === 0 ? (
                <p className="sidebar-copy compact-copy">
                  No active materials matched the current query.
                </p>
              ) : null}
              {materialSearchError ? (
                <p className="status-error">{materialSearchError}</p>
              ) : null}
            </article>
          </section>

          <section className="evaluation-column evaluation-column-wide">
            <article className="instrument-panel notes-panel">
              <label className="panel-label" htmlFor="olfactive-notes">
                OLFACTIVE NOTES
              </label>
              <textarea
                id="olfactive-notes"
                className="text-area notes-input"
                name="olfactiveNotes"
                onChange={(event) => setPreRevealNote(event.target.value)}
                placeholder="Describe profiles: top, heart, base notes, intensity, texture markers…"
                value={preRevealNote}
              />
              <div className="notes-footer">
                <span className="panel-label">
                  SELECTED: {selectedMaterial?.name ?? 'NONE'}
                </span>
                <span className="panel-label">
                  {editingEntrySequence === null
                    ? `CAPTURED: ${entries.length} / ${sessionTarget}`
                    : `EDITING ENTRY: ${String(editingEntrySequence).padStart(2, '0')}`}
                </span>
              </div>
            </article>

            <div className="evaluation-actions">
              <button
                className="secondary-action secondary-action-wide"
                disabled={
                  isAdvancing || isFinalizingSession || entries.length >= sessionTarget
                }
                onClick={() => {
                  void handleAdvance('skip')
                }}
                type="button"
              >
                <span className="action-inline">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    skip_next
                  </span>
                  <span>SKIP BOTTLE</span>
                </span>
              </button>
                <button
                  className="primary-action primary-action-wide"
                  disabled={
                  isAdvancing ||
                  isFinalizingSession ||
                  isValidatingCode ||
                  entries.length >= sessionTarget ||
                  validatedCode?.status !== 'valid' ||
                  selectedMaterial === null
                }
                  onClick={() => {
                    void handleAdvance('guess')
                  }}
                  type="button"
                >
                {isFinalizingSession ? (
                  <span className="action-inline">
                    <span aria-hidden="true" className="spinner" />
                    <span>BUILDING REPORT</span>
                  </span>
                  ) : editingEntrySequence !== null ? (
                    <span className="action-inline">
                      <span>SAVE ENTRY</span>
                      <span className="material-symbols-outlined" aria-hidden="true">
                        edit
                      </span>
                    </span>
                  ) : isLastBottle ? (
                    <span className="action-inline">
                      <span>COMPLETE SESSION</span>
                      <span className="material-symbols-outlined" aria-hidden="true">
                        fact_check
                      </span>
                    </span>
                  ) : (
                    <span className="action-inline">
                      <span>NEXT BOTTLE</span>
                      <span className="material-symbols-outlined" aria-hidden="true">
                        arrow_forward
                      </span>
                    </span>
                  )}
                </button>
            </div>

            <article className="instrument-panel queue-panel">
              <div className="queue-header">
                <div className="queue-header-copy">
                  <p className="panel-label">CAPTURED MANIFEST</p>
                  <p className="sidebar-copy compact-copy">
                    Click any entry to revise its guess or note before the session closes.
                  </p>
                </div>
                <div className="queue-header-actions">
                  {editingEntrySequence !== null ? (
                    <button
                      className="text-button"
                      onClick={resetCurrentBottle}
                      type="button"
                    >
                      CANCEL EDIT
                    </button>
                  ) : null}
                </div>
              </div>
              {entries.length > 0 ? (
                <div className="queue-list">
                  {entries.map((entry) => (
                    <button
                      key={`${entry.sequence}-${entry.code}`}
                      className={`queue-row${
                        entry.sequence === editingEntrySequence ? ' is-editing' : ''
                      }`}
                      onClick={() => beginEditingEntry(entry)}
                      type="button"
                    >
                      <span className="queue-row-sequence">
                        {String(entry.sequence).padStart(2, '0')}
                      </span>
                      <span className="queue-row-code">
                        {entry.code === null ? '---' : String(entry.code).padStart(3, '0')}
                      </span>
                      <span className="queue-row-material">
                        {entry.guessedMaterial?.name ?? 'SKIPPED'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="sidebar-copy compact-copy">
                  No bottles are queued yet. Validate a code, record a guess, then
                  advance through the session.
                </p>
              )}
            </article>

            {flowError ? <p className="status-error">{flowError}</p> : null}
            {sessionFinalizeError ? (
              <p className="status-error">{sessionFinalizeError}</p>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  )
}

type SessionReportViewProps = {
  createdSession: SessionStartResult | null
  isSavingSessionNote: boolean
  report: SessionReport | null
  resetSessionFlow: () => void
  saveSessionNote: () => Promise<void>
  sessionNote: string
  sessionNoteError: string | null
  setSessionNote: (value: string) => void
}

function SessionReportView({
  createdSession,
  isSavingSessionNote,
  report,
  resetSessionFlow,
  saveSessionNote,
  sessionNote,
  sessionNoteError,
  setSessionNote,
}: SessionReportViewProps) {
  if (!createdSession || !report) {
    return (
      <EmptySessionState
        copy="No completed session report is available yet. Finish an evaluation run to reveal the report view."
        ctaLabel="RETURN TO SETUP"
        onClick={() => resetSessionFlow()}
      />
    )
  }

  const accuracyRate =
    report.guessedCount > 0 ? (report.correctCount / report.guessedCount) * 100 : 0
  const totalSessionTime = formatSessionDuration(
    createdSession.startedAt,
    report.completedAt,
  )

  return (
    <section className="session-screen report-screen">
      <header className="report-header">
        <div>
          <p className="panel-label accent-copy">FINAL ANALYSIS OUTPUT</p>
          <h2 className="session-title">SESSION_COMPLETE_REPORT</h2>
        </div>
        <div className="report-header-actions">
          <button
            className="secondary-action"
            onClick={() => resetSessionFlow()}
            type="button"
          >
            <span className="action-inline">
              <span>START NEW SESSION</span>
              <span className="material-symbols-outlined" aria-hidden="true">
                restart_alt
              </span>
            </span>
          </button>
        </div>
      </header>

      <section className="report-metrics" aria-label="Session report metrics">
        <article className="metric-card metric-card-report">
          <p className="panel-label">TOTAL SAMPLES</p>
          <p className="report-metric-value">
            {numberFormatter.format(report.rows.length)}
          </p>
        </article>
        <article className="metric-card metric-card-report">
          <p className="panel-label">ACCURACY RATE</p>
          <p className="report-metric-value">{accuracyRate.toFixed(1)}%</p>
        </article>
        <article className="metric-card metric-card-report">
          <p className="panel-label">SKIPPED</p>
          <p className="report-metric-value">
            {numberFormatter.format(report.skippedCount)}
          </p>
        </article>
        <article className="metric-card metric-card-report">
          <p className="panel-label">SESSION DATE</p>
          <p className="report-metric-value report-metric-value-small">
            {dateTimeFormatter.format(new Date(report.completedAt))}
          </p>
        </article>
      </section>

      <section className="report-table-panel">
        <table className="report-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Bottle Code</th>
              <th>Your Guess</th>
              <th>Correct Material</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={`${row.sequence}-${row.code}`}>
                <td>{String(row.sequence).padStart(3, '0')}</td>
                <td className="report-code-cell">{row.code ?? '---'}</td>
                <td>{row.guessedMaterialName ?? 'SKIPPED'}</td>
                <td>{row.trueMaterialName}</td>
                <td>
                  <span className={`status-chip ${statusChipClass(row.status)}`}>
                    {row.status === 'match'
                      ? 'MATCH'
                      : row.status === 'mismatch'
                        ? 'MISMATCH'
                        : 'SKIPPED'}
                  </span>
                </td>
                <td>{row.note || 'No notes recorded.'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="report-panels">
        <article className="panel">
          <p className="panel-label">PROTOCOL SUMMARY</p>
          <div className="summary-list">
            <div>
              <span>SESSION ID</span>
              <strong>{createdSession.sessionId}</strong>
            </div>
            <div>
              <span>STARTED</span>
              <strong>{dateTimeFormatter.format(new Date(createdSession.startedAt))}</strong>
            </div>
            <div>
              <span>ATTEMPTS LOGGED</span>
              <strong>{numberFormatter.format(report.guessedCount)}</strong>
            </div>
            <div>
              <span>SESSION TIME</span>
              <strong>{totalSessionTime}</strong>
            </div>
          </div>
        </article>
        <article className="panel">
          <p className="panel-label">SESSION NOTES</p>
          <textarea
            className="text-area report-session-note"
            name="sessionNote"
            onBlur={() => {
              void saveSessionNote()
            }}
            onChange={(event) => setSessionNote(event.target.value)}
            placeholder="Record whole-session observations, fatigue notes, or recurring confusion patterns…"
            value={sessionNote}
          />
          <div className="report-note-meta">
            <p className="panel-label">
              {isSavingSessionNote ? 'SAVING…' : 'SESSION NOTE READY'}
            </p>
          </div>
          {sessionNoteError ? <p className="status-error">{sessionNoteError}</p> : null}
        </article>
      </section>
    </section>
  )
}

type StaticRouteViewProps = {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}

function StaticRouteView({
  eyebrow,
  title,
  description,
  children,
}: StaticRouteViewProps) {
  return (
    <section className="static-route">
      <header className="route-header">
        <div className="route-heading-group">
          <p className="panel-label accent-copy">{eyebrow}</p>
          <h2 className="session-title route-title">{title}</h2>
        </div>
        <p className="sidebar-copy">{description}</p>
      </header>
      <div className="panel-grid">{children}</div>
    </section>
  )
}

type EmptySessionStateProps = {
  copy: string
  ctaLabel: string
  onClick: () => void
}

function EmptySessionState({ copy, ctaLabel, onClick }: EmptySessionStateProps) {
  return (
    <section className="static-route">
      <header className="route-header">
        <div className="route-heading-group">
          <p className="panel-label accent-copy">SESSION CONTEXT</p>
          <h2 className="session-title route-title">NO ACTIVE SESSION</h2>
        </div>
        <p className="sidebar-copy">{copy}</p>
      </header>
      <div className="panel">
        <button className="primary-action" onClick={onClick} type="button">
          {ctaLabel}
        </button>
      </div>
    </section>
  )
}

type ImportsViewProps = {
  hasTauriRuntime: boolean
}

type ImportsConsoleProps = {
  hasTauriRuntime: boolean
}

type SettingsViewProps = {
  bootstrapError: string | null
  bootstrapStatus: BootstrapStatus | null
  hasTauriRuntime: boolean
  refreshBootstrapStatus: () => Promise<void>
}

function SettingsView({
  bootstrapError,
  bootstrapStatus,
  hasTauriRuntime,
  refreshBootstrapStatus,
}: SettingsViewProps) {
  const [backupExportPath, setBackupExportPath] = useState('')
  const [backupExportResult, setBackupExportResult] =
    useState<DatabaseBackupExportResult | null>(null)
  const [backupExportError, setBackupExportError] = useState<string | null>(null)
  const [restorePath, setRestorePath] = useState('')
  const [restoreInspection, setRestoreInspection] =
    useState<DatabaseBackupMetadata | null>(null)
  const [restoreResult, setRestoreResult] =
    useState<DatabaseBackupRestoreResult | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false)
  const [isExportingBackup, setIsExportingBackup] = useState(false)
  const [isInspectingBackup, setIsInspectingBackup] = useState(false)
  const [isRestoringBackup, setIsRestoringBackup] = useState(false)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)

  async function handleRefreshStatus() {
    setIsRefreshingStatus(true)

    try {
      await refreshBootstrapStatus()
    } finally {
      setIsRefreshingStatus(false)
    }
  }

  async function handleChooseBackupExportPath() {
    const selectedPath = await save({
      title: 'Export Blindly backup',
      defaultPath: createBackupFilename(),
      filters: [
        {
          name: 'SQLite backup',
          extensions: ['sqlite3', 'sqlite', 'db'],
        },
      ],
    })

    if (!selectedPath) {
      return
    }

    setBackupExportPath(selectedPath)
    setBackupExportError(null)
  }

  async function handleExportBackup() {
    if (!hasTauriRuntime) {
      setBackupExportError(
        'Backups are only available inside the Tauri desktop runtime.',
      )
      return
    }

    const destinationPath = backupExportPath.trim()
    if (!destinationPath) {
      setBackupExportError('Enter a destination file path before exporting a backup.')
      return
    }

    setIsExportingBackup(true)
    setBackupExportError(null)

    try {
      const result = await invoke<DatabaseBackupExportResult>(
        'export_database_backup',
        { destinationPath },
      )
      setBackupExportResult(result)
      await refreshBootstrapStatus()
    } catch (error) {
      setBackupExportResult(null)
      setBackupExportError(String(error))
    } finally {
      setIsExportingBackup(false)
    }
  }

  async function handleChooseRestoreBackup() {
    const selectedPath = await open({
      title: 'Select Blindly backup',
      multiple: false,
      filters: [
        {
          name: 'SQLite backup',
          extensions: ['sqlite3', 'sqlite', 'db'],
        },
      ],
    })

    if (typeof selectedPath !== 'string') {
      return
    }

    setRestorePath(selectedPath)
    setRestoreInspection(null)
    setRestoreResult(null)
    setRestoreError(null)
    setRestoreConfirmed(false)
  }

  async function handleInspectBackup() {
    if (!hasTauriRuntime) {
      setRestoreError('Restore is only available inside the Tauri desktop runtime.')
      return
    }

    const backupPath = restorePath.trim()
    if (!backupPath) {
      setRestoreError('Enter a backup file path before inspecting it.')
      return
    }

    setIsInspectingBackup(true)
    setRestoreError(null)
    setRestoreConfirmed(false)

    try {
      const metadata = await invoke<DatabaseBackupMetadata>(
        'inspect_database_backup',
        { backupPath },
      )
      setRestoreInspection(metadata)
      setRestoreResult(null)
    } catch (error) {
      setRestoreInspection(null)
      setRestoreResult(null)
      setRestoreError(String(error))
    } finally {
      setIsInspectingBackup(false)
    }
  }

  async function handleRestoreBackup() {
    if (!hasTauriRuntime) {
      setRestoreError('Restore is only available inside the Tauri desktop runtime.')
      return
    }

    const backupPath = restorePath.trim()
    if (!backupPath) {
      setRestoreError('Enter a backup file path before restoring it.')
      return
    }

    if (!restoreInspection) {
      setRestoreError('Inspect the backup first so the restore target is explicit.')
      return
    }

    if (!restoreConfirmed) {
      setRestoreError('Confirm that restore will replace the current local database.')
      return
    }

    setIsRestoringBackup(true)
    setRestoreError(null)

    try {
      const result = await invoke<DatabaseBackupRestoreResult>(
        'restore_database_backup',
        { backupPath },
      )
      setRestoreResult(result)
      setRestoreInspection(result.restoredBackup)
      setRestoreConfirmed(false)
      await refreshBootstrapStatus()
    } catch (error) {
      setRestoreResult(null)
      setRestoreError(String(error))
    } finally {
      setIsRestoringBackup(false)
    }
  }

  return (
    <StaticRouteView
      eyebrow="LOCAL SYSTEM"
      title="04_SETTINGS"
      description=""
    >
      <article className="panel settings-card settings-card-wide">
        <div className="settings-card-header">
          <p className="panel-label">CURRENT DATABASE</p>
          <p className="sidebar-copy compact-copy">
            Blindly stores its live SQLite file inside the Tauri app data directory.
            Backup and restore operate on that file only. No remote sync is
            involved.
          </p>
        </div>
        <div className="summary-list">
          <div>
            <span>LIVE DATABASE PATH</span>
            <strong>{bootstrapStatus?.dbPath ?? 'Unavailable'}</strong>
          </div>
          <div>
            <span>SCHEMA VERSION</span>
            <strong>
              {bootstrapStatus
                ? numberFormatter.format(bootstrapStatus.schemaVersion)
                : 'Unavailable'}
            </strong>
          </div>
          <div>
            <span>TABLE COUNT</span>
            <strong>
              {bootstrapStatus
                ? numberFormatter.format(bootstrapStatus.tableCount)
                : 'Unavailable'}
            </strong>
          </div>
        </div>
        <div className="settings-meta-list">
          <div>
            <span>RUNTIME</span>
            <strong>{hasTauriRuntime ? 'Desktop runtime active' : 'Web preview only'}</strong>
          </div>
        </div>
        <div className="settings-card-actions">
          <button
            className="secondary-action"
            disabled={!hasTauriRuntime || isRefreshingStatus}
            onClick={() => {
              void handleRefreshStatus()
            }}
            type="button"
          >
            {isRefreshingStatus ? (
              <span className="action-inline">
                <span aria-hidden="true" className="spinner spinner-secondary" />
                <span>REFRESH STATUS</span>
              </span>
            ) : (
              'REFRESH STATUS'
            )}
          </button>
        </div>
        {bootstrapError ? <p className="status-error">{bootstrapError}</p> : null}
      </article>

      <section className="settings-section">
        <header className="settings-section-header">
          <div className="route-heading-group">
            <p className="panel-label accent-copy">IMPORT</p>
            <h3 className="topbar-title">LOCAL DATA IN</h3>
          </div>
          <p className="sidebar-copy compact-copy">
            Import materials and bottles from CSV, or bring a full backup back into
            the app after inspection and confirmation.
          </p>
        </header>
        <div className="settings-section-grid">
          <ImportsConsole hasTauriRuntime={hasTauriRuntime} />
          <article className="panel settings-card">
            <div className="settings-card-header">
              <p className="panel-label">RESTORE BACKUP</p>
              <p className="sidebar-copy compact-copy">
                Inspect a backup first, then confirm before replacing the live local
                database.
              </p>
            </div>
            <div className="settings-meta-list">
              <div>
                <span>SELECTED BACKUP</span>
                <strong>{restorePath || 'No backup selected.'}</strong>
              </div>
              <div>
                <span>RESTORE RULE</span>
                <strong>Inspect first, then replace local data</strong>
              </div>
            </div>
            <div className="settings-card-notice" role="note">
              <p className="panel-label warning-label">DESTRUCTIVE ACTION</p>
              <p className="sidebar-copy compact-copy">
                Blindly keeps one automatic pre-restore safety copy next to the live
                database before replacement.
              </p>
            </div>
            <div className="settings-card-actions">
              <button
                className="secondary-action"
                disabled={!hasTauriRuntime || isInspectingBackup || isRestoringBackup}
                onClick={() => {
                  void handleChooseRestoreBackup()
                }}
                type="button"
              >
                CHOOSE BACKUP…
              </button>
              <button
                className="secondary-action"
                disabled={
                  !hasTauriRuntime ||
                  isInspectingBackup ||
                  isRestoringBackup ||
                  !restorePath
                }
                onClick={() => {
                  void handleInspectBackup()
                }}
                type="button"
              >
                {isInspectingBackup ? (
                  <span className="action-inline">
                    <span aria-hidden="true" className="spinner spinner-secondary" />
                    <span>INSPECT</span>
                  </span>
                ) : (
                  'INSPECT'
                )}
              </button>
              <button
                className="primary-action"
                disabled={
                  !hasTauriRuntime ||
                  isInspectingBackup ||
                  isRestoringBackup ||
                  restoreInspection === null ||
                  !restoreConfirmed
                }
                onClick={() => {
                  void handleRestoreBackup()
                }}
                type="button"
              >
                {isRestoringBackup ? (
                  <span className="action-inline">
                    <span aria-hidden="true" className="spinner" />
                    <span>RESTORE BACKUP</span>
                  </span>
                ) : (
                  'RESTORE BACKUP'
                )}
              </button>
            </div>
            {restoreInspection ? (
              <label className="confirmation-row">
                <input
                  checked={restoreConfirmed}
                  name="restoreConfirmed"
                  onChange={(event) => setRestoreConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I understand this will replace the current local SQLite database
                  on this machine.
                </span>
              </label>
            ) : null}
            <SettingsStatusPanel
              emptyMessage="Inspect a backup before restoring so the schema and file details are visible first."
              errorMessage={restoreError}
              title="Restore status"
            >
              {restoreInspection ? (
                <BackupMetadataSummary metadata={restoreInspection}>
                  {restoreResult?.previousDatabaseBackupPath ? (
                    <div>
                      <span>PRE-RESTORE SAFETY COPY</span>
                      <strong>{restoreResult.previousDatabaseBackupPath}</strong>
                    </div>
                  ) : null}
                </BackupMetadataSummary>
              ) : null}
            </SettingsStatusPanel>
          </article>
        </div>
      </section>

      <section className="settings-section">
        <header className="settings-section-header">
          <div className="route-heading-group">
            <p className="panel-label accent-copy">EXPORT</p>
            <h3 className="topbar-title">LOCAL DATA OUT</h3>
          </div>
          <p className="sidebar-copy compact-copy">
            Create a portable SQLite backup you can move to another install without
            using Git or remote sync.
          </p>
        </header>
        <div className="settings-section-grid">
          <article className="panel settings-card">
            <div className="settings-card-header">
              <p className="panel-label">EXPORT FULL BACKUP</p>
              <p className="sidebar-copy compact-copy">
                Export writes a full SQLite backup file chosen through the system
                save dialog.
              </p>
            </div>
            <div className="settings-meta-list">
              <div>
                <span>DESTINATION</span>
                <strong>{backupExportPath || 'No destination selected.'}</strong>
              </div>
              <div>
                <span>FORMAT</span>
                <strong>Raw SQLite copy</strong>
              </div>
            </div>
            <div className="settings-card-actions">
              <button
                className="secondary-action"
                disabled={!hasTauriRuntime || isExportingBackup}
                onClick={() => {
                  void handleChooseBackupExportPath()
                }}
                type="button"
              >
                CHOOSE DESTINATION…
              </button>
              <button
                className="primary-action"
                disabled={!hasTauriRuntime || isExportingBackup || !backupExportPath}
                onClick={() => {
                  void handleExportBackup()
                }}
                type="button"
              >
                {isExportingBackup ? (
                  <span className="action-inline">
                    <span aria-hidden="true" className="spinner" />
                    <span>EXPORT BACKUP</span>
                  </span>
                ) : (
                  'EXPORT BACKUP'
                )}
              </button>
            </div>
            <SettingsStatusPanel
              emptyMessage="Export a backup to create a portable local SQLite copy you can move to another install."
              errorMessage={backupExportError}
              title="Export status"
            >
              {backupExportResult ? (
                <BackupMetadataSummary metadata={backupExportResult.backup}>
                  <div>
                    <span>LIVE DATABASE</span>
                    <strong>{backupExportResult.databasePath}</strong>
                  </div>
                </BackupMetadataSummary>
              ) : null}
            </SettingsStatusPanel>
          </article>
        </div>
      </section>
    </StaticRouteView>
  )
}

function ImportsConsole({ hasTauriRuntime }: ImportsConsoleProps) {
  const [materialsPath, setMaterialsPath] = useState('')
  const [bottlesPath, setBottlesPath] = useState('')
  const [bottlesMode, setBottlesMode] =
    useState<BottlesImportMode>('upsert_by_code')
  const [materialsSummary, setMaterialsSummary] =
    useState<MaterialsImportSummary | null>(null)
  const [bottlesSummary, setBottlesSummary] =
    useState<BottlesImportSummary | null>(null)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [bottlesError, setBottlesError] = useState<string | null>(null)
  const [isPreviewingMaterials, setIsPreviewingMaterials] = useState(false)
  const [isCommittingMaterials, setIsCommittingMaterials] = useState(false)
  const [isPreviewingBottles, setIsPreviewingBottles] = useState(false)
  const [isCommittingBottles, setIsCommittingBottles] = useState(false)

  async function handleChooseMaterialsFile() {
    const selectedPath = await open({
      title: 'Select materials CSV',
      multiple: false,
      filters: [
        {
          name: 'CSV',
          extensions: ['csv'],
        },
      ],
    })

    if (typeof selectedPath !== 'string') {
      return
    }

    setMaterialsPath(selectedPath)
    setMaterialsSummary(null)
    setMaterialsError(null)
  }

  async function handleChooseBottlesFile() {
    const selectedPath = await open({
      title: 'Select bottles CSV',
      multiple: false,
      filters: [
        {
          name: 'CSV',
          extensions: ['csv'],
        },
      ],
    })

    if (typeof selectedPath !== 'string') {
      return
    }

    setBottlesPath(selectedPath)
    setBottlesSummary(null)
    setBottlesError(null)
  }

  async function handleMaterialsImport(action: 'preview' | 'commit') {
    if (!hasTauriRuntime) {
      setMaterialsError('Imports are only available inside the Tauri desktop runtime.')
      return
    }

    const filePath = materialsPath.trim()
    if (!filePath) {
      setMaterialsError('Enter a materials CSV path before running the import.')
      return
    }

    setMaterialsError(null)
    if (action === 'preview') {
      setIsPreviewingMaterials(true)
    } else {
      setIsCommittingMaterials(true)
    }

    try {
      const summary = await invoke<MaterialsImportSummary>(
        action === 'preview' ? 'preview_materials_import' : 'commit_materials_import',
        { filePath },
      )
      setMaterialsSummary(summary)
    } catch (error) {
      setMaterialsSummary(null)
      setMaterialsError(String(error))
    } finally {
      if (action === 'preview') {
        setIsPreviewingMaterials(false)
      } else {
        setIsCommittingMaterials(false)
      }
    }
  }

  async function handleBottlesImport(action: 'preview' | 'commit') {
    if (!hasTauriRuntime) {
      setBottlesError('Imports are only available inside the Tauri desktop runtime.')
      return
    }

    const filePath = bottlesPath.trim()
    if (!filePath) {
      setBottlesError('Enter a bottles CSV path before running the import.')
      return
    }

    setBottlesError(null)
    if (action === 'preview') {
      setIsPreviewingBottles(true)
    } else {
      setIsCommittingBottles(true)
    }

    try {
      const summary = await invoke<BottlesImportSummary>(
        action === 'preview' ? 'preview_bottles_import' : 'commit_bottles_import',
        { filePath, mode: bottlesMode },
      )
      setBottlesSummary(summary)
    } catch (error) {
      setBottlesSummary(null)
      setBottlesError(String(error))
    } finally {
      if (action === 'preview') {
        setIsPreviewingBottles(false)
      } else {
        setIsCommittingBottles(false)
      }
    }
  }

  return (
    <>
      <article className="panel settings-card">
        <div className="settings-card-header">
          <p className="panel-label">MATERIALS CSV</p>
          <p className="sidebar-copy compact-copy">
            Reads the `name` column only and skips normalized-name duplicates
            already present in the database.
          </p>
        </div>
        <div className="settings-meta-list">
          <div>
            <span>SELECTED FILE</span>
            <strong>{materialsPath || 'No file selected.'}</strong>
          </div>
          <div>
            <span>EXPECTED COLUMN</span>
            <strong>name</strong>
          </div>
        </div>
        <div className="settings-card-actions">
          <button
            className="secondary-action"
            disabled={!hasTauriRuntime || isPreviewingMaterials || isCommittingMaterials}
            onClick={() => {
              void handleChooseMaterialsFile()
            }}
            type="button"
          >
            CHOOSE CSV…
          </button>
          <button
            className="secondary-action"
            disabled={
              !hasTauriRuntime ||
              isPreviewingMaterials ||
              isCommittingMaterials ||
              !materialsPath
            }
            onClick={() => {
              void handleMaterialsImport('preview')
            }}
            type="button"
          >
            {isPreviewingMaterials ? (
              <span className="action-inline">
                <span aria-hidden="true" className="spinner spinner-secondary" />
                <span>PREVIEW</span>
              </span>
            ) : (
              'PREVIEW'
            )}
          </button>
          <button
            className="primary-action"
            disabled={
              !hasTauriRuntime ||
              isPreviewingMaterials ||
              isCommittingMaterials ||
              !materialsPath
            }
            onClick={() => {
              void handleMaterialsImport('commit')
            }}
            type="button"
          >
            {isCommittingMaterials ? (
              <span className="action-inline">
                <span aria-hidden="true" className="spinner" />
                <span>COMMIT</span>
              </span>
            ) : (
              'COMMIT'
            )}
          </button>
        </div>
        <ImportStatusPanel
          emptyMessage="Preview a materials CSV to inspect creates, duplicates, and row-level validation."
          errorMessage={materialsError}
          summary={materialsSummary}
          title="Materials import status"
        >
          {materialsSummary ? (
            <>
              <dl className="summary-grid">
                <div>
                  <dt>ROWS READ</dt>
                  <dd>{numberFormatter.format(materialsSummary.rowsRead)}</dd>
                </div>
                <div>
                  <dt>NEW MATERIALS</dt>
                  <dd>{numberFormatter.format(materialsSummary.creates)}</dd>
                </div>
                <div>
                  <dt>DUPLICATES</dt>
                  <dd>{numberFormatter.format(materialsSummary.duplicatesSkipped)}</dd>
                </div>
                <div>
                  <dt>ERRORS</dt>
                  <dd>{numberFormatter.format(materialsSummary.errors.length)}</dd>
                </div>
              </dl>
              <ImportIssuesTable issues={materialsSummary.errors} />
            </>
          ) : null}
        </ImportStatusPanel>
      </article>

      <article className="panel settings-card">
        <div className="settings-card-header">
          <p className="panel-label">BOTTLES CSV</p>
          <p className="sidebar-copy compact-copy">
            Requires `Material Name`, `Code`, and `Dillution`. Upsert mode updates
            existing bottle mappings explicitly by code.
          </p>
        </div>
        <div className="settings-card-field">
          <label className="field-label" htmlFor="bottles-import-mode">
            Import mode
          </label>
          <select
            id="bottles-import-mode"
            className="text-input select-input"
            name="bottlesImportMode"
            onChange={(event) =>
              setBottlesMode(event.target.value as BottlesImportMode)
            }
            value={bottlesMode}
          >
            <option value="upsert_by_code">upsert_by_code</option>
            <option value="append_only">append_only</option>
          </select>
        </div>
        <div className="settings-meta-list">
          <div>
            <span>SELECTED FILE</span>
            <strong>{bottlesPath || 'No file selected.'}</strong>
          </div>
        </div>
        <div className="settings-card-actions">
          <button
            className="secondary-action"
            disabled={!hasTauriRuntime || isPreviewingBottles || isCommittingBottles}
            onClick={() => {
              void handleChooseBottlesFile()
            }}
            type="button"
          >
            CHOOSE CSV…
          </button>
          <button
            className="secondary-action"
            disabled={
              !hasTauriRuntime ||
              isPreviewingBottles ||
              isCommittingBottles ||
              !bottlesPath
            }
            onClick={() => {
              void handleBottlesImport('preview')
            }}
            type="button"
          >
            {isPreviewingBottles ? (
              <span className="action-inline">
                <span aria-hidden="true" className="spinner spinner-secondary" />
                <span>PREVIEW</span>
              </span>
            ) : (
              'PREVIEW'
            )}
          </button>
          <button
            className="primary-action"
            disabled={
              !hasTauriRuntime ||
              isPreviewingBottles ||
              isCommittingBottles ||
              !bottlesPath
            }
            onClick={() => {
              void handleBottlesImport('commit')
            }}
            type="button"
          >
            {isCommittingBottles ? (
              <span className="action-inline">
                <span aria-hidden="true" className="spinner" />
                <span>COMMIT</span>
              </span>
            ) : (
              'COMMIT'
            )}
          </button>
        </div>
        <ImportStatusPanel
          emptyMessage="Preview a bottles CSV to inspect created materials, bottle inserts, and upsert updates."
          errorMessage={bottlesError}
          summary={bottlesSummary}
          title="Bottle import status"
        >
          {bottlesSummary ? (
            <>
              <dl className="summary-grid">
                <div>
                  <dt>ROWS READ</dt>
                  <dd>{numberFormatter.format(bottlesSummary.rowsRead)}</dd>
                </div>
                <div>
                  <dt>NEW MATERIALS</dt>
                  <dd>{numberFormatter.format(bottlesSummary.createMaterials)}</dd>
                </div>
                <div>
                  <dt>NEW BOTTLES</dt>
                  <dd>{numberFormatter.format(bottlesSummary.createBottles)}</dd>
                </div>
                <div>
                  <dt>UPDATES</dt>
                  <dd>{numberFormatter.format(bottlesSummary.updateBottles)}</dd>
                </div>
                <div>
                  <dt>ERRORS</dt>
                  <dd>{numberFormatter.format(bottlesSummary.errors.length)}</dd>
                </div>
                <div>
                  <dt>MODE</dt>
                  <dd>{bottlesSummary.mode}</dd>
                </div>
              </dl>
              <ImportIssuesTable issues={bottlesSummary.errors} />
            </>
          ) : null}
        </ImportStatusPanel>
      </article>
    </>
  )
}

function ImportsView({ hasTauriRuntime }: ImportsViewProps) {
  return (
    <StaticRouteView
      eyebrow="TRANSFER CONSOLE"
      title="IMPORTS MOVED"
      description="CSV import controls now live under Settings so local backup, restore, and import operations stay in one place."
    >
      <article className="panel">
        <p className="panel-label">CURRENT LOCATION</p>
        <p className="sidebar-copy compact-copy">
          Open Settings to run material imports, bottle imports, backup export, and
          backup restore from the same local data console.
        </p>
        {!hasTauriRuntime ? (
          <p className="status-error">
            Settings actions are only available inside the Tauri desktop runtime.
          </p>
        ) : null}
      </article>
    </StaticRouteView>
  )
}

type ImportStatusPanelProps = {
  children?: ReactNode
  emptyMessage: string
  errorMessage: string | null
  summary: MaterialsImportSummary | BottlesImportSummary | null
  title: string
}

function ImportStatusPanel({
  children,
  emptyMessage,
  errorMessage,
  summary,
  title,
}: ImportStatusPanelProps) {
  return (
    <div className="session-status-block" aria-live="polite">
      <p className="panel-label">{title}</p>
      {summary ? (
        <>
          <p className="sidebar-copy compact-copy">
            {summary.committed
              ? 'Import committed successfully.'
              : 'Preview generated. Commit remains explicit.'}
          </p>
          {children}
        </>
      ) : (
        <p className="sidebar-copy compact-copy">{emptyMessage}</p>
      )}
      {errorMessage ? <p className="status-error">{errorMessage}</p> : null}
    </div>
  )
}

type SettingsStatusPanelProps = {
  children?: ReactNode
  emptyMessage: string
  errorMessage: string | null
  title: string
}

function SettingsStatusPanel({
  children,
  emptyMessage,
  errorMessage,
  title,
}: SettingsStatusPanelProps) {
  return (
    <div className="session-status-block" aria-live="polite">
      <p className="panel-label">{title}</p>
      {children ? children : <p className="sidebar-copy compact-copy">{emptyMessage}</p>}
      {errorMessage ? <p className="status-error">{errorMessage}</p> : null}
    </div>
  )
}

type BackupMetadataSummaryProps = {
  children?: ReactNode
  metadata: DatabaseBackupMetadata
}

function BackupMetadataSummary({
  children,
  metadata,
}: BackupMetadataSummaryProps) {
  return (
    <>
      <dl className="summary-grid">
        <div>
          <dt>FILE SIZE</dt>
          <dd>{formatFileSize(metadata.fileSizeBytes)}</dd>
        </div>
        <div>
          <dt>SCHEMA VERSION</dt>
          <dd>{numberFormatter.format(metadata.schemaVersion)}</dd>
        </div>
        <div>
          <dt>TABLE COUNT</dt>
          <dd>{numberFormatter.format(metadata.tableCount)}</dd>
        </div>
      </dl>
      <div className="summary-list">
        <div>
          <span>BACKUP FILE</span>
          <strong>{metadata.path}</strong>
        </div>
        {children}
      </div>
    </>
  )
}

type ImportIssuesTableProps = {
  issues: ImportIssue[]
}

function ImportIssuesTable({ issues }: ImportIssuesTableProps) {
  if (issues.length === 0) {
    return <p className="import-success-copy">No row-level validation errors.</p>
  }

  return (
    <div className="data-table import-issues-table">
      <div className="table-row table-head import-issues-head">
        <span>Row</span>
        <span>Issue</span>
      </div>
      {issues.map((issue) => (
        <div key={`${issue.row}-${issue.message}`} className="table-row import-issues-row">
          <span>{issue.row}</span>
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  )
}

function renderCodeDigits(codeInput: string) {
  return Array.from({ length: 3 }, (_, index) => codeInput[index] ?? '0')
}

function formatElapsedTime(startedAt: string) {
  const elapsedMs = Math.max(0, Date.now() - new Date(startedAt).getTime())
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function formatFileSize(fileSizeBytes: number) {
  if (fileSizeBytes < 1024) {
    return `${numberFormatter.format(fileSizeBytes)} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = fileSizeBytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function createBackupFilename() {
  const now = new Date()
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ]

  return `blindly_backup_${parts[0]}${parts[1]}${parts[2]}_${parts[3]}${parts[4]}${parts[5]}.sqlite3`
}

function statusChipClass(status: SessionReportRow['status']) {
  if (status === 'match') {
    return 'is-success'
  }

  if (status === 'mismatch') {
    return 'is-error'
  }

  return 'is-neutral'
}

function getSidebarStatus({
  currentRoute,
  createdSession,
  sessionElapsedTime,
  sessionReport,
}: {
  currentRoute: RouteKey
  createdSession: SessionStartResult | null
  sessionElapsedTime: string
  sessionReport: SessionReport | null
}) {
  if (currentRoute === 'session-active' && createdSession) {
    return {
      title: 'EVAL ONGOING',
      detail: sessionElapsedTime,
      emphasis: 'timer' as const,
    }
  }

  if (currentRoute === 'session-report' && sessionReport) {
    return {
      title: 'OUTPUT GENERATED',
      detail: `${sessionReport.rows.length} ROWS RESOLVED`,
      emphasis: 'default' as const,
    }
  }

  return {
    title: 'READY',
    detail: 'SYSTEM IDLE',
    emphasis: 'default' as const,
  }
}

function formatSessionDuration(startedAt: string, completedAt: string) {
  const elapsedMs = Math.max(
    0,
    new Date(completedAt).getTime() - new Date(startedAt).getTime(),
  )
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

export default App
