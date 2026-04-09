import { useDeferredValue, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ClearableInput } from './ClearableInput'

type PerformanceViewProps = {
  hasTauriRuntime: boolean
}

type PerformanceSnapshot = {
  sessions: PerformanceSessionRecord[]
  attempts: PerformanceAttemptRecord[]
  entries: PerformanceSessionEntryRecord[]
}

type DeletedSessionResult = {
  sessionId: string
  deletedAttemptCount: number
  deletedEntryCount: number
}

type PerformanceSessionRecord = {
  sessionId: string
  startedAt: string
  endedAt: string | null
  targetBatchSize: number
  sessionNote: string | null
}

type PerformanceAttemptRecord = {
  attemptId: string
  sessionId: string
  bottleId: string
  bottleCode: number
  dilution: string
  trueMaterialId: string
  trueMaterialName: string
  guessedMaterialId: string
  guessedMaterialName: string
  isCorrect: boolean
  preRevealNote: string | null
  revealedAt: string
}

type PerformanceSessionEntryRecord = {
  entryId: string
  sessionId: string
  sequence: number
  bottleId: string | null
  bottleCode: number | null
  dilution: string | null
  trueMaterialId: string | null
  trueMaterialName: string | null
  guessedMaterialId: string | null
  guessedMaterialName: string | null
  status: 'match' | 'mismatch' | 'skipped'
  preRevealNote: string | null
  revealedAt: string | null
}

type DateRangeFilter = '30d' | '90d' | 'all'

type SessionSummary = {
  sessionId: string
  startedAt: string
  completedAt: string
  targetBatchSize: number
  completedEntries: number
  revealedAttempts: number
  skippedCount: number
  correctCount: number
  incorrectCount: number
  accuracyRate: number
  durationSeconds: number
  sessionNote: string | null
  entryNoteCount: number
  entryNotesText: string
  visibleEntries: PerformanceSessionEntryRecord[]
}

type MaterialPerformanceRow = {
  materialId: string
  materialName: string
  attemptCount: number
  correctCount: number
  incorrectCount: number
  accuracyRate: number
  lastSeenAt: string
}

type ConfusionPairRow = {
  key: string
  trueMaterialId: string
  trueMaterialName: string
  guessedMaterialId: string
  guessedMaterialName: string
  confusionCount: number
  confusionRate: number
  lastOccurredAt: string
}

type TrendPoint = {
  sessionId: string
  completedAt: string
  accuracyRate: number
  revealedAttempts: number
  targetBatchSize: number
}

type SortDirection = 'desc' | 'asc'

type MaterialSortKey =
  | 'materialName'
  | 'attemptCount'
  | 'correctCount'
  | 'incorrectCount'
  | 'accuracyRate'
  | 'lastSeenAt'

type ConfusionSortKey =
  | 'trueMaterialName'
  | 'guessedMaterialName'
  | 'confusionCount'
  | 'confusionRate'
  | 'lastOccurredAt'

type MaterialSortState = {
  key: MaterialSortKey
  direction: SortDirection
}

type ConfusionSortState = {
  key: ConfusionSortKey
  direction: SortDirection
}

const MATERIAL_SORT_COLUMNS: Array<{ key: MaterialSortKey; label: string }> = [
  { key: 'materialName', label: 'Material' },
  { key: 'attemptCount', label: 'Attempts' },
  { key: 'correctCount', label: 'Correct' },
  { key: 'incorrectCount', label: 'Incorrect' },
  { key: 'accuracyRate', label: 'Accuracy' },
  { key: 'lastSeenAt', label: 'Last Seen' },
]

const CONFUSION_SORT_COLUMNS: Array<{ key: ConfusionSortKey; label: string }> = [
  { key: 'trueMaterialName', label: 'True Material' },
  { key: 'guessedMaterialName', label: 'Guessed Material' },
  { key: 'confusionCount', label: 'Count' },
  { key: 'confusionRate', label: 'Wrong-Share' },
  { key: 'lastOccurredAt', label: 'Last Occurrence' },
]

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const sessionStampFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const numberFormatter = new Intl.NumberFormat()
const percentFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

export function PerformanceView({ hasTauriRuntime }: PerformanceViewProps) {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDeletingSession, setIsDeletingSession] = useState(false)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'performance' | 'sessions'>(
    'performance',
  )
  const [performanceDateRange, setPerformanceDateRange] =
    useState<DateRangeFilter>('all')
  const [performanceMaterialId, setPerformanceMaterialId] = useState('all')
  const [sessionsDateRange, setSessionsDateRange] = useState<DateRangeFilter>('all')
  const [sessionsMaterialId, setSessionsMaterialId] = useState('all')
  const [sessionsNoteQuery, setSessionsNoteQuery] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [materialSort, setMaterialSort] = useState<MaterialSortState>({
    key: 'attemptCount',
    direction: 'desc',
  })
  const [confusionSort, setConfusionSort] = useState<ConfusionSortState>({
    key: 'confusionCount',
    direction: 'desc',
  })
  const deferredSessionsNoteQuery = useDeferredValue(sessionsNoteQuery)

  async function loadSnapshot() {
    setIsLoading(true)
    setLoadError(null)

    try {
      const result = await invoke<PerformanceSnapshot>('get_performance_snapshot')
      setSnapshot(result)
    } catch (error) {
      setSnapshot(null)
      setLoadError(String(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!hasTauriRuntime) {
      return
    }

    let isCancelled = false
    void (async () => {
      setIsLoading(true)
      setLoadError(null)

      try {
        const result = await invoke<PerformanceSnapshot>('get_performance_snapshot')
        if (!isCancelled) {
          setSnapshot(result)
        }
      } catch (error) {
        if (!isCancelled) {
          setSnapshot(null)
          setLoadError(String(error))
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [hasTauriRuntime])

  async function handleDeleteSession(sessionId: string) {
    if (!hasTauriRuntime || isDeletingSession) {
      return
    }

    setIsDeletingSession(true)
    setLoadError(null)

    try {
      await invoke<DeletedSessionResult>('delete_session', { sessionId })
      setSelectedSessionId(null)
      setPendingDeleteSessionId(null)
      await loadSnapshot()
    } catch (error) {
      setLoadError(String(error))
    } finally {
      setIsDeletingSession(false)
    }
  }

  const materialOptions = getMaterialOptions(snapshot?.attempts ?? [])
  const allAttemptsBySessionId = groupAttemptsBySession(snapshot?.attempts ?? [])
  const persistedEntriesBySessionId = groupSessionEntries(snapshot?.entries ?? [])
  const sessionHistoryEntriesBySessionId = buildSessionHistoryEntries(
    snapshot?.sessions ?? [],
    persistedEntriesBySessionId,
    allAttemptsBySessionId,
  )
  const performanceAttempts = (snapshot?.attempts ?? []).filter((attempt) =>
    matchesAttemptFilters(attempt, performanceDateRange, performanceMaterialId),
  )
  const performanceConfusionAttempts = (snapshot?.attempts ?? []).filter((attempt) =>
    matchesDateRange(attempt.revealedAt, performanceDateRange),
  )
  const performanceAttemptsBySessionId = groupAttemptsBySession(performanceAttempts)
  const sessionSummaries = (snapshot?.sessions ?? [])
    .map((session) =>
      createSessionSummary(
        session,
        sessionHistoryEntriesBySessionId.get(session.sessionId) ?? [],
        filterSessionEntries(
          sessionHistoryEntriesBySessionId.get(session.sessionId) ?? [],
          sessionsMaterialId,
        ),
      ),
    )
    .filter((summary) =>
      matchesSessionFilters(
        summary,
        sessionsDateRange,
        sessionsMaterialId,
        deferredSessionsNoteQuery,
      ),
    )
    .sort(
      (left, right) =>
        new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime(),
    )

  const selectedSessionIdOrDefault = sessionSummaries.some(
    (summary) => summary.sessionId === selectedSessionId,
  )
    ? selectedSessionId
    : (sessionSummaries[0]?.sessionId ?? null)
  const selectedSession =
    sessionSummaries.find((summary) => summary.sessionId === selectedSessionIdOrDefault) ??
    null
  const pendingDeleteSession =
    sessionSummaries.find((summary) => summary.sessionId === pendingDeleteSessionId) ?? null
  const selectedSessionNoteEntries =
    selectedSession?.visibleEntries.filter(
      (entry) => (entry.preRevealNote?.trim().length ?? 0) > 0,
    ) ?? []
  const materialRows = buildMaterialPerformanceRows(performanceAttempts)
  const confusionRows = buildConfusionRows(
    performanceConfusionAttempts,
    performanceMaterialId,
  )
  const sortedMaterialRows = sortMaterialPerformanceRows(materialRows, materialSort)
  const sortedConfusionRows = sortConfusionRows(confusionRows, confusionSort)
  const performanceSessionSummaries = (snapshot?.sessions ?? [])
    .map((session) =>
      createSessionSummary(
        session,
        createLegacySessionEntries(allAttemptsBySessionId.get(session.sessionId) ?? []),
        createLegacySessionEntries(
          performanceAttemptsBySessionId.get(session.sessionId) ?? [],
        ),
      ),
    )
    .filter((summary) => summary.revealedAttempts > 0)
    .sort(
      (left, right) =>
        new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime(),
    )
  const trendPoints = buildTrendPoints(performanceSessionSummaries)

  const totalCorrectAttempts = performanceAttempts.filter((attempt) => attempt.isCorrect).length
  const overallAccuracy =
    performanceAttempts.length > 0
      ? (totalCorrectAttempts / performanceAttempts.length) * 100
      : 0
  const recentAttempts = performanceAttempts.filter((attempt) =>
    isWithinLastDays(attempt.revealedAt, 30),
  )
  const recentCorrectAttempts = recentAttempts.filter((attempt) => attempt.isCorrect).length
  const recentAccuracy =
    recentAttempts.length > 0 ? (recentCorrectAttempts / recentAttempts.length) * 100 : 0

  return (
    <section className="static-route performance-route">
      <header className="route-header performance-header">
        <div className="route-heading-group">
          <p className="panel-label accent-copy">ANALYTICS ARRAY</p>
          <h2 className="session-title route-title">03_PERFORMANCE</h2>
        </div>
        <p className="sidebar-copy">
          Historical accuracy, material recognition, confusion clusters, and session notes
          resolve here from the revealed attempt log.
        </p>
      </header>

      <div className="performance-section-switcher">
        <div
          aria-label="Performance section switcher"
          className="inventory-segmented-control"
          role="tablist"
        >
          <button
            aria-selected={activeSection === 'performance'}
            className={`inventory-segment${activeSection === 'performance' ? ' is-active' : ''}`}
            onClick={() => setActiveSection('performance')}
            role="tab"
            type="button"
          >
            Performance
          </button>
          <button
            aria-selected={activeSection === 'sessions'}
            className={`inventory-segment${activeSection === 'sessions' ? ' is-active' : ''}`}
            onClick={() => setActiveSection('sessions')}
            role="tab"
            type="button"
          >
            Sessions
          </button>
        </div>
      </div>

      {activeSection === 'performance' ? (
        <>
          <section className="inventory-summary-grid" aria-label="Performance summary">
            <article className="inventory-summary-card performance-summary-card">
              <span className="inventory-summary-id">ID: PERF_ACC</span>
              <strong className="inventory-summary-value performance-summary-value-small">
                {formatPercent(overallAccuracy)}
              </strong>
              <p className="inventory-summary-label">OVERALL_ACCURACY</p>
            </article>
            <article className="inventory-summary-card performance-summary-card">
              <span className="inventory-summary-id">ID: PERF_30D</span>
              <strong className="inventory-summary-value performance-summary-value-small">
                {formatPercent(recentAccuracy)}
              </strong>
              <p className="inventory-summary-label">LAST_30_DAY_ACCURACY</p>
            </article>
            <article className="inventory-summary-card performance-summary-card">
              <span className="inventory-summary-id">ID: PERF_SES</span>
              <strong className="inventory-summary-value">
                {numberFormatter.format(performanceSessionSummaries.length)}
              </strong>
              <p className="inventory-summary-label">MATCHED_SESSIONS</p>
            </article>
          </section>

          <section className="panel performance-toolbar-panel">
            <div className="performance-toolbar performance-toolbar-compact">
              <div className="performance-filter-group">
                <p className="panel-label">TIME WINDOW</p>
                <div
                  aria-label="Date range"
                  className="inventory-segmented-control performance-segmented-control-slim"
                  role="tablist"
                >
                  <button
                    aria-selected={performanceDateRange === '30d'}
                    className={`inventory-segment${performanceDateRange === '30d' ? ' is-active' : ''}`}
                    onClick={() => setPerformanceDateRange('30d')}
                    role="tab"
                    type="button"
                  >
                    30D
                  </button>
                  <button
                    aria-selected={performanceDateRange === '90d'}
                    className={`inventory-segment${performanceDateRange === '90d' ? ' is-active' : ''}`}
                    onClick={() => setPerformanceDateRange('90d')}
                    role="tab"
                    type="button"
                  >
                    90D
                  </button>
                  <button
                    aria-selected={performanceDateRange === 'all'}
                    className={`inventory-segment${performanceDateRange === 'all' ? ' is-active' : ''}`}
                    onClick={() => setPerformanceDateRange('all')}
                    role="tab"
                    type="button"
                  >
                    ALL
                  </button>
                </div>
              </div>

              <div className="performance-filter-fields performance-filter-fields-compact">
                <label className="inventory-filter-field">
                  <span className="field-label">Material</span>
                  <select
                    className="text-input select-input"
                    name="materialFilter"
                    onChange={(event) => setPerformanceMaterialId(event.target.value)}
                    value={performanceMaterialId}
                  >
                    <option value="all">all materials</option>
                    {materialOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {loadError ? <p className="status-error">{loadError}</p> : null}
            {!hasTauriRuntime ? (
              <p className="status-error">
                Performance analytics are only available inside the Tauri desktop runtime.
              </p>
            ) : null}
          </section>

          <section className="performance-main-panel">
            <article className="panel performance-chart-panel">
              <div className="performance-panel-header">
                <div>
                  <p className="panel-label">TREND SIGNAL</p>
                  <h3 className="topbar-title">Accuracy Over Time</h3>
                </div>
                <p className="sidebar-copy compact-copy">
                  Line shows accuracy rate. Bars show revealed attempts per session.
                </p>
              </div>
              {isLoading ? (
                <p className="sidebar-copy compact-copy">Loading analytics…</p>
              ) : (
                <TrendChart points={trendPoints} />
              )}
            </article>

            <article className="panel performance-table-panel">
              <div className="performance-panel-header">
                <div>
                  <p className="panel-label">MATERIAL RESPONSE</p>
                  <h3 className="topbar-title">Per-Material Performance</h3>
                </div>
              </div>
              <div className="data-table performance-table">
                <div className="table-row table-head performance-grid performance-grid-materials">
                  {MATERIAL_SORT_COLUMNS.map((column) => (
                    <span key={column.key}>
                      <SortableTableHeader
                        direction={materialSort.direction}
                        isActive={materialSort.key === column.key}
                        label={column.label}
                        onClick={() =>
                          setMaterialSort((current) => toggleSortState(current, column.key))
                        }
                      />
                    </span>
                  ))}
                </div>
                {sortedMaterialRows.map((row) => (
                  <div
                    key={row.materialId}
                    className="table-row performance-grid performance-grid-materials"
                  >
                    <span className="inventory-primary-text">{row.materialName}</span>
                    <span>{numberFormatter.format(row.attemptCount)}</span>
                    <span>{numberFormatter.format(row.correctCount)}</span>
                    <span>{numberFormatter.format(row.incorrectCount)}</span>
                    <span className="performance-metric-text">
                      {formatPercent(row.accuracyRate)}
                    </span>
                    <span>{shortDateFormatter.format(new Date(row.lastSeenAt))}</span>
                  </div>
                ))}
              </div>
              {materialRows.length === 0 ? (
                <p className="sidebar-copy compact-copy">
                  No material performance rows match the current filters.
                </p>
              ) : null}
            </article>

            <article className="panel performance-table-panel">
              <div className="performance-panel-header">
                <div>
                  <p className="panel-label">CONFUSION CLUSTERS</p>
                  <h3 className="topbar-title">Recurring Wrong Pairs</h3>
                </div>
              </div>
              <div className="data-table performance-table">
                <div className="table-row table-head performance-grid performance-grid-confusions">
                  {CONFUSION_SORT_COLUMNS.map((column) => (
                    <span key={column.key}>
                      <SortableTableHeader
                        direction={confusionSort.direction}
                        isActive={confusionSort.key === column.key}
                        label={column.label}
                        onClick={() =>
                          setConfusionSort((current) => toggleSortState(current, column.key))
                        }
                      />
                    </span>
                  ))}
                </div>
                {sortedConfusionRows.map((row) => (
                  <div
                    key={row.key}
                    className="table-row performance-grid performance-grid-confusions"
                  >
                    <span className="inventory-primary-text">{row.trueMaterialName}</span>
                    <span>{row.guessedMaterialName}</span>
                    <span>{numberFormatter.format(row.confusionCount)}</span>
                    <span className="performance-metric-text">
                      {formatPercent(row.confusionRate)}
                    </span>
                    <span>{shortDateFormatter.format(new Date(row.lastOccurredAt))}</span>
                  </div>
                ))}
              </div>
              {confusionRows.length === 0 ? (
                <p className="sidebar-copy compact-copy">
                  No recurring confusion pairs match the current filters.
                </p>
              ) : null}
            </article>
          </section>
        </>
      ) : (
        <>
          <section className="performance-session-filters">
            <section className="panel performance-toolbar-panel">
              <div className="performance-toolbar performance-toolbar-compact">
                <div className="performance-filter-group">
                  <p className="panel-label">TIME WINDOW</p>
                  <div
                    aria-label="Date range"
                    className="inventory-segmented-control performance-segmented-control-slim"
                    role="tablist"
                  >
                    <button
                      aria-selected={sessionsDateRange === '30d'}
                      className={`inventory-segment${sessionsDateRange === '30d' ? ' is-active' : ''}`}
                      onClick={() => setSessionsDateRange('30d')}
                      role="tab"
                      type="button"
                    >
                      30D
                    </button>
                    <button
                      aria-selected={sessionsDateRange === '90d'}
                      className={`inventory-segment${sessionsDateRange === '90d' ? ' is-active' : ''}`}
                      onClick={() => setSessionsDateRange('90d')}
                      role="tab"
                      type="button"
                    >
                      90D
                    </button>
                    <button
                      aria-selected={sessionsDateRange === 'all'}
                      className={`inventory-segment${sessionsDateRange === 'all' ? ' is-active' : ''}`}
                      onClick={() => setSessionsDateRange('all')}
                      role="tab"
                      type="button"
                    >
                      ALL
                    </button>
                  </div>
                </div>

                <div className="performance-filter-fields performance-filter-fields-compact">
                  <label className="inventory-filter-field">
                    <span className="field-label">Material</span>
                    <select
                      className="text-input select-input"
                      name="materialFilter"
                      onChange={(event) => setSessionsMaterialId(event.target.value)}
                      value={sessionsMaterialId}
                    >
                      <option value="all">all materials</option>
                      {materialOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {loadError ? <p className="status-error">{loadError}</p> : null}
              {!hasTauriRuntime ? (
                <p className="status-error">
                  Performance analytics are only available inside the Tauri desktop runtime.
                </p>
              ) : null}
            </section>

            <section className="panel performance-search-panel">
              <label className="inventory-filter-field">
                <span className="field-label">Note Search</span>
                <ClearableInput
                  className="text-input"
                  clearLabel="Clear session history search"
                  name="noteQuery"
                  onChange={setSessionsNoteQuery}
                  placeholder="Search session or attempt notes…"
                  spellCheck={false}
                  value={sessionsNoteQuery}
                />
              </label>
            </section>
          </section>

          <section className="performance-workspace performance-workspace-sessions">
            <div className="performance-main-panel">
            <article className="panel performance-session-panel">
              <div className="performance-panel-header">
                <div>
                  <p className="panel-label">SESSION HISTORY</p>
                  <h3 className="topbar-title">Historical Runs</h3>
                </div>
                <p className="sidebar-copy compact-copy">
                  {numberFormatter.format(sessionSummaries.length)} sessions in the current scope
                </p>
              </div>

              <div
                className="data-table performance-session-table"
                role="table"
                aria-label="Sessions"
              >
                <div className="table-row table-head performance-grid performance-grid-sessions">
                  <span>Session</span>
                  <span>Protocol</span>
                </div>
                {sessionSummaries.map((summary) => (
                  <button
                    key={summary.sessionId}
                    className={`table-row performance-grid performance-grid-sessions performance-session-row${
                      summary.sessionId === selectedSessionIdOrDefault ? ' is-selected' : ''
                    }`}
                    onClick={() => setSelectedSessionId(summary.sessionId)}
                    type="button"
                  >
                    <span className="performance-session-primary">
                      <strong>
                        {sessionStampFormatter.format(new Date(summary.completedAt))}
                      </strong>
                      <small>{summary.sessionId}</small>
                    </span>
                    <span className="performance-session-stats">
                      <strong className="performance-metric-text">
                        {formatPercent(summary.accuracyRate)}
                      </strong>
                      <small>
                        {summary.completedEntries} / {summary.targetBatchSize} logged
                      </small>
                      <small>
                        {summary.revealedAttempts} reveals • {summary.skippedCount} skips
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              {sessionSummaries.length === 0 ? (
                <p className="sidebar-copy compact-copy">
                  No sessions match the current filters.
                </p>
              ) : null}
            </article>
            </div>

            <aside className="performance-detail-column">
              <article className="panel performance-detail-panel">
                <div className="performance-panel-header performance-panel-header-session-detail">
                  <div className="performance-session-detail-heading">
                    <div className="performance-session-detail-label-row">
                      <p className="panel-label">SELECTED SESSION</p>
                      {selectedSession ? (
                        <button
                          aria-label={`Delete session ${selectedSession.sessionId}`}
                          className="performance-delete-button"
                          disabled={isDeletingSession}
                          onClick={() => {
                            setPendingDeleteSessionId(selectedSession.sessionId)
                          }}
                          title="Delete session"
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            className="performance-delete-icon"
                            viewBox="0 0 24 24"
                          >
                            <path d="M9 3.75h6a1.5 1.5 0 0 1 1.5 1.5v.75H21v1.5h-1.2l-.9 12.02A2.25 2.25 0 0 1 16.66 21H7.34a2.25 2.25 0 0 1-2.24-1.48L4.2 7.5H3V6h4.5v-.75A1.5 1.5 0 0 1 9 3.75Zm1.5 2.25h3V5.25H10.5V6Zm-3.8 1.5.83 11.08a.75.75 0 0 0 .75.67h8.44a.75.75 0 0 0 .75-.67L18.3 7.5H6.7ZM9.75 10.5h1.5v5.25h-1.5V10.5Zm3 0h1.5v5.25h-1.5V10.5Z" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                    <h3 className="topbar-title">
                      {selectedSession ? 'Session Detail' : 'No Session Selected'}
                    </h3>
                  </div>
                </div>

                {selectedSession ? (
                  <>
                    <div className="summary-list">
                      <div>
                        <span>SESSION ID</span>
                        <strong>{selectedSession.sessionId}</strong>
                      </div>
                      <div>
                        <span>STARTED</span>
                        <strong>
                          {dateTimeFormatter.format(new Date(selectedSession.startedAt))}
                        </strong>
                      </div>
                      <div>
                        <span>COMPLETED</span>
                        <strong>
                          {dateTimeFormatter.format(new Date(selectedSession.completedAt))}
                        </strong>
                      </div>
                      <div>
                        <span>DURATION</span>
                        <strong>{formatDuration(selectedSession.durationSeconds)}</strong>
                      </div>
                      <div>
                        <span>LOGGED / TARGET</span>
                        <strong>
                          {selectedSession.completedEntries} / {selectedSession.targetBatchSize}
                        </strong>
                      </div>
                      <div>
                        <span>REVEALS</span>
                        <strong>{selectedSession.revealedAttempts}</strong>
                      </div>
                      <div>
                        <span>SKIPS</span>
                        <strong>{selectedSession.skippedCount}</strong>
                      </div>
                      <div>
                        <span>ACCURACY</span>
                        <strong>{formatPercent(selectedSession.accuracyRate)}</strong>
                      </div>
                    </div>

                    <div className="performance-note-block">
                      <p className="panel-label">SESSION NOTE</p>
                      <p className="sidebar-copy compact-copy performance-note-copy">
                        {selectedSession.sessionNote?.trim() || 'No session-level note recorded.'}
                      </p>
                    </div>

                    <div className="performance-attempt-log">
                      <div className="performance-panel-header">
                        <div>
                          <p className="panel-label">ENTRY NOTES</p>
                          <h4 className="topbar-title performance-subtitle">Note Log</h4>
                        </div>
                      </div>
                      {selectedSessionNoteEntries.length > 0 ? (
                        <div className="data-table performance-table">
                          <div className="table-row table-head performance-grid performance-grid-attempt-notes">
                            <span>Code</span>
                            <span>Status</span>
                            <span>Note</span>
                          </div>
                          {selectedSessionNoteEntries.map((entry) => (
                            <div
                              key={`${entry.entryId}-note`}
                              className="table-row performance-grid performance-grid-attempt-notes"
                            >
                              <span className="inventory-code">
                                {entry.bottleCode === null
                                  ? '---'
                                  : String(entry.bottleCode).padStart(3, '0')}
                              </span>
                              <span>
                                <span className={`status-chip ${sessionEntryStatusChipClass(entry)}`}>
                                  {sessionEntryStatusLabel(entry)}
                                </span>
                              </span>
                              <span className="performance-note-text">
                                {entry.preRevealNote?.trim()}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="sidebar-copy compact-copy">
                          No entry notes are available for this session in the current filter scope.
                        </p>
                      )}
                    </div>

                    <div className="performance-attempt-log">
                      <div className="performance-panel-header">
                        <div>
                          <p className="panel-label">SESSION LOG</p>
                          <h4 className="topbar-title performance-subtitle">Captured Entries</h4>
                        </div>
                      </div>
                      <div className="data-table performance-table">
                        <div className="table-row table-head performance-grid performance-grid-attempts">
                          <span>Code</span>
                          <span>Guess</span>
                          <span>True</span>
                          <span>Status</span>
                        </div>
                        {selectedSession.visibleEntries.map((entry) => (
                          <div
                            key={entry.entryId}
                            className="table-row performance-grid performance-grid-attempts"
                          >
                            <span className="inventory-code">
                              {entry.bottleCode === null
                                ? '---'
                                : String(entry.bottleCode).padStart(3, '0')}
                            </span>
                            <span>{entry.guessedMaterialName ?? 'Skipped'}</span>
                            <span>{entry.trueMaterialName ?? 'Not entered'}</span>
                            <span>
                              <span className={`status-chip ${sessionEntryStatusChipClass(entry)}`}>
                                {sessionEntryStatusLabel(entry)}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                      {selectedSession.visibleEntries.length === 0 ? (
                        <p className="sidebar-copy compact-copy">
                          No entries in this session match the current filters.
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="sidebar-copy compact-copy">
                    Select a session from the history list to inspect its metrics and notes.
                  </p>
                )}
              </article>
            </aside>
          </section>
        </>
      )}

      {pendingDeleteSession ? (
        <div
          aria-labelledby="delete-session-title"
          aria-modal="true"
          className="modal-overlay"
          role="dialog"
        >
          <div className="modal-panel">
            <p className="panel-label accent-copy">DELETE SESSION</p>
            <h2 id="delete-session-title" className="modal-title">
              REMOVE THIS SESSION?
            </h2>
            <p className="sidebar-copy">
              This removes <strong>{pendingDeleteSession.sessionId}</strong> and its captured
              entries from the local database.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-action"
                disabled={isDeletingSession}
                onClick={() => setPendingDeleteSessionId(null)}
                type="button"
              >
                CANCEL
              </button>
              <button
                className="danger-action"
                disabled={isDeletingSession}
                onClick={() => {
                  void handleDeleteSession(pendingDeleteSession.sessionId)
                }}
                type="button"
              >
                {isDeletingSession ? (
                  <span className="action-inline">
                    <span aria-hidden="true" className="spinner" />
                    <span>DELETE</span>
                  </span>
                ) : (
                  'DELETE'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SortableTableHeader({
  direction,
  isActive,
  label,
  onClick,
}: {
  direction: SortDirection
  isActive: boolean
  label: string
  onClick: () => void
}) {
  const sortLabel = isActive
    ? `${label}, sorted ${direction === 'desc' ? 'descending' : 'ascending'}`
    : `${label}, sort descending`

  return (
    <button
      aria-label={sortLabel}
      className={`performance-sort-button${isActive ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="performance-sort-button-label">{label}</span>
      <svg
        aria-hidden="true"
        className="performance-sort-icon"
        viewBox="0 0 12 12"
      >
        <path
          className={isActive && direction === 'asc' ? 'is-active' : undefined}
          d="M6 2 8.5 4.8H3.5Z"
        />
        <path
          className={isActive && direction === 'desc' ? 'is-active' : undefined}
          d="M6 10 3.5 7.2H8.5Z"
        />
      </svg>
    </button>
  )
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="performance-chart-empty">
        <p className="sidebar-copy compact-copy">
          No trend points are available for the current filter scope.
        </p>
      </div>
    )
  }

  const width = 760
  const height = 284
  const paddingLeft = 58
  const paddingRight = 22
  const axisLabelX = paddingLeft - 10
  const labelY = 266
  const topY = 24
  const lineBottomY = 170
  const barBottomY = 230
  const barTopY = 182
  const usableWidth = width - paddingLeft - paddingRight
  const step = points.length > 1 ? usableWidth / (points.length - 1) : 0
  const maxAttempts = Math.max(...points.map((point) => point.revealedAttempts), 1)
  const useTimeLabels = shouldUseTimeLabels(points)

  const polylinePoints = points
    .map((point, index) => {
      const x = paddingLeft + step * index
      const y = lineBottomY - (point.accuracyRate / 100) * (lineBottomY - topY)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="performance-chart-shell">
      <svg
        aria-label="Accuracy and revealed attempts trend"
        className="performance-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 25, 50, 75, 100].map((value) => {
          const y = lineBottomY - (value / 100) * (lineBottomY - topY)
          return (
            <g key={value}>
              <line
                className="performance-chart-grid"
                x1={paddingLeft}
                x2={width - paddingRight}
                y1={y}
                y2={y}
              />
              <text
                className="performance-chart-axis"
                textAnchor="end"
                x={axisLabelX}
                y={y + 4}
              >
                {value}
              </text>
            </g>
          )
        })}

        <line
          className="performance-chart-baseline"
          x1={paddingLeft}
          x2={width - paddingRight}
          y1={barBottomY}
          y2={barBottomY}
        />

        {points.map((point, index) => {
          const x = paddingLeft + step * index
          const barWidth = Math.min(24, Math.max(10, usableWidth / Math.max(points.length * 2, 10)))
          const barHeight =
            ((point.revealedAttempts / maxAttempts) * (barBottomY - barTopY)) || 0
          const barY = barBottomY - barHeight
          const lineY =
            lineBottomY - (point.accuracyRate / 100) * (lineBottomY - topY)

          return (
            <g key={point.sessionId}>
              <title>
                {`${dateTimeFormatter.format(new Date(point.completedAt))} · ${formatPercent(
                  point.accuracyRate,
                )} accuracy · ${point.revealedAttempts}/${point.targetBatchSize} revealed`}
              </title>
              <rect
                className="performance-chart-bar"
                height={Math.max(barHeight, 2)}
                rx="0"
                width={barWidth}
                x={x - barWidth / 2}
                y={barY}
              />
              <circle className="performance-chart-point" cx={x} cy={lineY} r="4.5" />
              <text className="performance-chart-label" x={x} y={labelY}>
                {useTimeLabels
                  ? shortTimeFormatter.format(new Date(point.completedAt))
                  : shortDateFormatter.format(new Date(point.completedAt))}
              </text>
            </g>
          )
        })}

        <polyline className="performance-chart-line" points={polylinePoints} />
      </svg>
      <div className="performance-chart-legend">
        <span>ACCURACY RATE</span>
        <span>REVEALED ATTEMPTS</span>
      </div>
    </div>
  )
}

function getMaterialOptions(attempts: PerformanceAttemptRecord[]) {
  const materialMap = new Map<string, string>()

  for (const attempt of attempts) {
    if (!materialMap.has(attempt.trueMaterialId)) {
      materialMap.set(attempt.trueMaterialId, attempt.trueMaterialName)
    }
  }

  return [...materialMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function groupAttemptsBySession(attempts: PerformanceAttemptRecord[]) {
  const groupedAttempts = new Map<string, PerformanceAttemptRecord[]>()

  for (const attempt of attempts) {
    const currentAttempts = groupedAttempts.get(attempt.sessionId)
    if (currentAttempts) {
      currentAttempts.push(attempt)
      continue
    }

    groupedAttempts.set(attempt.sessionId, [attempt])
  }

  return groupedAttempts
}

function groupSessionEntries(entries: PerformanceSessionEntryRecord[]) {
  const groupedEntries = new Map<string, PerformanceSessionEntryRecord[]>()

  for (const entry of entries) {
    const currentEntries = groupedEntries.get(entry.sessionId)
    if (currentEntries) {
      currentEntries.push(entry)
      continue
    }

    groupedEntries.set(entry.sessionId, [entry])
  }

  return groupedEntries
}

function buildSessionHistoryEntries(
  sessions: PerformanceSessionRecord[],
  persistedEntriesBySessionId: Map<string, PerformanceSessionEntryRecord[]>,
  attemptsBySessionId: Map<string, PerformanceAttemptRecord[]>,
) {
  const sessionEntriesBySessionId = new Map<string, PerformanceSessionEntryRecord[]>()

  for (const session of sessions) {
    const persistedEntries = persistedEntriesBySessionId.get(session.sessionId) ?? []
    if (persistedEntries.length > 0) {
      sessionEntriesBySessionId.set(
        session.sessionId,
        [...persistedEntries].sort((left, right) => left.sequence - right.sequence),
      )
      continue
    }

    sessionEntriesBySessionId.set(
      session.sessionId,
      createLegacySessionEntries(attemptsBySessionId.get(session.sessionId) ?? []),
    )
  }

  return sessionEntriesBySessionId
}

function createLegacySessionEntries(attempts: PerformanceAttemptRecord[]) {
  return [...attempts]
    .sort(
      (left, right) =>
        new Date(left.revealedAt).getTime() - new Date(right.revealedAt).getTime(),
    )
    .map<PerformanceSessionEntryRecord>((attempt, index) => ({
      entryId: `legacy_${attempt.attemptId}`,
      sessionId: attempt.sessionId,
      sequence: index + 1,
      bottleId: attempt.bottleId,
      bottleCode: attempt.bottleCode,
      dilution: attempt.dilution,
      trueMaterialId: attempt.trueMaterialId,
      trueMaterialName: attempt.trueMaterialName,
      guessedMaterialId: attempt.guessedMaterialId,
      guessedMaterialName: attempt.guessedMaterialName,
      status: attempt.isCorrect ? 'match' : 'mismatch',
      preRevealNote: attempt.preRevealNote,
      revealedAt: attempt.revealedAt,
    }))
}

function filterSessionEntries(
  entries: PerformanceSessionEntryRecord[],
  selectedMaterialId: string,
) {
  if (selectedMaterialId === 'all') {
    return entries
  }

  return entries.filter(
    (entry) =>
      entry.trueMaterialId === selectedMaterialId ||
      entry.guessedMaterialId === selectedMaterialId,
  )
}

function matchesAttemptFilters(
  attempt: PerformanceAttemptRecord,
  dateRange: DateRangeFilter,
  selectedMaterialId: string,
) {
  if (!matchesDateRange(attempt.revealedAt, dateRange)) {
    return false
  }

  if (selectedMaterialId !== 'all' && attempt.trueMaterialId !== selectedMaterialId) {
    return false
  }

  return true
}

function matchesSessionFilters(
  summary: SessionSummary,
  dateRange: DateRangeFilter,
  selectedMaterialId: string,
  noteQuery: string,
) {
  const normalizedQuery = noteQuery.trim().toLowerCase()
  const noteCorpus = `${summary.sessionNote ?? ''} ${summary.entryNotesText}`.toLowerCase()

  if (!matchesDateRange(summary.completedAt, dateRange)) {
    return false
  }

  if (selectedMaterialId !== 'all' && summary.visibleEntries.length === 0) {
    return false
  }

  if (!normalizedQuery && summary.completedEntries === 0) {
    return false
  }

  if (normalizedQuery && noteCorpus.includes(normalizedQuery)) {
    return true
  }

  if (summary.completedEntries === 0) {
    return false
  }

  return !normalizedQuery || noteCorpus.includes(normalizedQuery)
}

function createSessionSummary(
  session: PerformanceSessionRecord,
  allEntries: PerformanceSessionEntryRecord[],
  visibleEntries: PerformanceSessionEntryRecord[],
): SessionSummary {
  const lastEntryTimestamp = allEntries
    .map((entry) => (entry.revealedAt ? new Date(entry.revealedAt).getTime() : 0))
    .reduce((latest, current) => Math.max(latest, current), 0)
  const completedAt =
    session.endedAt ??
    (lastEntryTimestamp > 0 ? new Date(lastEntryTimestamp).toISOString() : session.startedAt)
  const correctCount = visibleEntries.filter((entry) => entry.status === 'match').length
  const incorrectCount = visibleEntries.filter((entry) => entry.status === 'mismatch').length
  const skippedCount = visibleEntries.filter((entry) => entry.status === 'skipped').length
  const revealedAttempts = correctCount + incorrectCount
  const entryNotes = visibleEntries
    .map((entry) => entry.preRevealNote?.trim() ?? '')
    .filter((note) => note.length > 0)
  const durationSeconds = Math.max(
    0,
    Math.round(
      (new Date(completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000,
    ),
  )

  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    completedAt,
    targetBatchSize: session.targetBatchSize,
    completedEntries: visibleEntries.length,
    revealedAttempts,
    skippedCount,
    correctCount,
    incorrectCount,
    accuracyRate: revealedAttempts > 0 ? (correctCount / revealedAttempts) * 100 : 0,
    durationSeconds,
    sessionNote: session.sessionNote,
    entryNoteCount: entryNotes.length,
    entryNotesText: entryNotes.join(' '),
    visibleEntries,
  }
}

function buildMaterialPerformanceRows(attempts: PerformanceAttemptRecord[]) {
  const rowsByMaterial = new Map<string, MaterialPerformanceRow>()

  for (const attempt of attempts) {
    const currentRow = rowsByMaterial.get(attempt.trueMaterialId)
    if (!currentRow) {
      rowsByMaterial.set(attempt.trueMaterialId, {
        materialId: attempt.trueMaterialId,
        materialName: attempt.trueMaterialName,
        attemptCount: 1,
        correctCount: attempt.isCorrect ? 1 : 0,
        incorrectCount: attempt.isCorrect ? 0 : 1,
        accuracyRate: attempt.isCorrect ? 100 : 0,
        lastSeenAt: attempt.revealedAt,
      })
      continue
    }

    currentRow.attemptCount += 1
    currentRow.correctCount += attempt.isCorrect ? 1 : 0
    currentRow.incorrectCount += attempt.isCorrect ? 0 : 1
    if (new Date(attempt.revealedAt).getTime() > new Date(currentRow.lastSeenAt).getTime()) {
      currentRow.lastSeenAt = attempt.revealedAt
    }
  }

  return [...rowsByMaterial.values()]
    .map((row) => ({
      ...row,
      accuracyRate: row.attemptCount > 0 ? (row.correctCount / row.attemptCount) * 100 : 0,
    }))
    .sort((left, right) => {
      if (right.attemptCount !== left.attemptCount) {
        return right.attemptCount - left.attemptCount
      }

      return left.materialName.localeCompare(right.materialName)
    })
}

function buildConfusionRows(
  attempts: PerformanceAttemptRecord[],
  selectedMaterialId: string,
) {
  const wrongAttempts = attempts.filter((attempt) => !attempt.isCorrect)
  const wrongCountsByTrueMaterial = new Map<string, number>()

  for (const attempt of wrongAttempts) {
    wrongCountsByTrueMaterial.set(
      attempt.trueMaterialId,
      (wrongCountsByTrueMaterial.get(attempt.trueMaterialId) ?? 0) + 1,
    )
  }

  const rowsByPair = new Map<string, ConfusionPairRow>()

  for (const attempt of wrongAttempts) {
    if (
      selectedMaterialId !== 'all' &&
      attempt.trueMaterialId !== selectedMaterialId &&
      attempt.guessedMaterialId !== selectedMaterialId
    ) {
      continue
    }

    const key = `${attempt.trueMaterialId}:${attempt.guessedMaterialId}`
    const currentRow = rowsByPair.get(key)
    if (!currentRow) {
      rowsByPair.set(key, {
        key,
        trueMaterialId: attempt.trueMaterialId,
        trueMaterialName: attempt.trueMaterialName,
        guessedMaterialId: attempt.guessedMaterialId,
        guessedMaterialName: attempt.guessedMaterialName,
        confusionCount: 1,
        confusionRate: 0,
        lastOccurredAt: attempt.revealedAt,
      })
      continue
    }

    currentRow.confusionCount += 1
    if (new Date(attempt.revealedAt).getTime() > new Date(currentRow.lastOccurredAt).getTime()) {
      currentRow.lastOccurredAt = attempt.revealedAt
    }
  }

  return [...rowsByPair.values()]
    .map((row) => ({
      ...row,
      confusionRate:
        row.confusionCount > 0
          ? (row.confusionCount / (wrongCountsByTrueMaterial.get(row.trueMaterialId) ?? 1)) * 100
          : 0,
    }))
    .sort((left, right) => {
      if (right.confusionCount !== left.confusionCount) {
        return right.confusionCount - left.confusionCount
      }

      return left.trueMaterialName.localeCompare(right.trueMaterialName)
    })
}

function buildTrendPoints(sessionSummaries: SessionSummary[]) {
  return sessionSummaries
    .filter((summary) => summary.revealedAttempts > 0)
    .sort(
      (left, right) =>
        new Date(left.completedAt).getTime() - new Date(right.completedAt).getTime(),
    )
    .map((summary) => ({
      sessionId: summary.sessionId,
      completedAt: summary.completedAt,
      accuracyRate: summary.accuracyRate,
      revealedAttempts: summary.revealedAttempts,
      targetBatchSize: summary.targetBatchSize,
    }))
}

function toggleSortState<T extends string>(
  currentState: { key: T; direction: SortDirection },
  nextKey: T,
): { key: T; direction: SortDirection } {
  if (currentState.key === nextKey) {
    return {
      key: nextKey,
      direction: currentState.direction === 'desc' ? 'asc' : 'desc',
    }
  }

  return {
    key: nextKey,
    direction: 'desc',
  }
}

function sortMaterialPerformanceRows(
  rows: MaterialPerformanceRow[],
  sortState: MaterialSortState,
) {
  return [...rows].sort((left, right) => {
    const multiplier = sortState.direction === 'asc' ? 1 : -1
    const comparison = compareMaterialPerformanceRows(left, right, sortState.key)

    if (comparison !== 0) {
      return comparison * multiplier
    }

    return left.materialName.localeCompare(right.materialName)
  })
}

function compareMaterialPerformanceRows(
  left: MaterialPerformanceRow,
  right: MaterialPerformanceRow,
  key: MaterialSortKey,
) {
  switch (key) {
    case 'materialName':
      return left.materialName.localeCompare(right.materialName)
    case 'attemptCount':
      return left.attemptCount - right.attemptCount
    case 'correctCount':
      return left.correctCount - right.correctCount
    case 'incorrectCount':
      return left.incorrectCount - right.incorrectCount
    case 'accuracyRate':
      return left.accuracyRate - right.accuracyRate
    case 'lastSeenAt':
      return new Date(left.lastSeenAt).getTime() - new Date(right.lastSeenAt).getTime()
  }
}

function sortConfusionRows(rows: ConfusionPairRow[], sortState: ConfusionSortState) {
  return [...rows].sort((left, right) => {
    const multiplier = sortState.direction === 'asc' ? 1 : -1
    const comparison = compareConfusionRows(left, right, sortState.key)

    if (comparison !== 0) {
      return comparison * multiplier
    }

    const trueMaterialComparison = left.trueMaterialName.localeCompare(right.trueMaterialName)
    if (trueMaterialComparison !== 0) {
      return trueMaterialComparison
    }

    return left.guessedMaterialName.localeCompare(right.guessedMaterialName)
  })
}

function compareConfusionRows(
  left: ConfusionPairRow,
  right: ConfusionPairRow,
  key: ConfusionSortKey,
) {
  switch (key) {
    case 'trueMaterialName':
      return left.trueMaterialName.localeCompare(right.trueMaterialName)
    case 'guessedMaterialName':
      return left.guessedMaterialName.localeCompare(right.guessedMaterialName)
    case 'confusionCount':
      return left.confusionCount - right.confusionCount
    case 'confusionRate':
      return left.confusionRate - right.confusionRate
    case 'lastOccurredAt':
      return (
        new Date(left.lastOccurredAt).getTime() - new Date(right.lastOccurredAt).getTime()
      )
  }
}

function matchesDateRange(isoDate: string, dateRange: DateRangeFilter) {
  if (dateRange === 'all') {
    return true
  }

  const days = dateRange === '30d' ? 30 : 90
  return isWithinLastDays(isoDate, days)
}

function isWithinLastDays(isoDate: string, days: number) {
  const now = Date.now()
  const threshold = now - days * 24 * 60 * 60 * 1000
  return new Date(isoDate).getTime() >= threshold
}

function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function shouldUseTimeLabels(points: TrendPoint[]) {
  if (points.length <= 1) {
    return false
  }

  const firstPointDate = new Date(points[0].completedAt)
  return points.every((point) => isSameCalendarDay(firstPointDate, new Date(point.completedAt)))
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function sessionEntryStatusLabel(entry: PerformanceSessionEntryRecord) {
  switch (entry.status) {
    case 'match':
      return 'MATCH'
    case 'mismatch':
      return 'MISMATCH'
    default:
      return 'SKIPPED'
  }
}

function sessionEntryStatusChipClass(entry: PerformanceSessionEntryRecord) {
  switch (entry.status) {
    case 'match':
      return 'is-success'
    case 'mismatch':
      return 'is-error'
    default:
      return 'is-neutral'
  }
}
