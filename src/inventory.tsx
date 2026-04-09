import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ClearableInput } from './ClearableInput'

type InventoryStatus = 'active' | 'archived'
type InventoryMode = 'materials' | 'bottles'
type InventoryFilter = InventoryStatus | 'all'
type MaterialFilter = InventoryFilter | 'no_active_bottles'

type InventoryViewProps = {
  hasTauriRuntime: boolean
}

type MaterialInventoryItem = {
  id: string
  name: string
  status: InventoryStatus
  activeBottleCount: number
  archivedBottleCount: number
  attemptCount: number
  createdAt: string
  updatedAt: string
}

type BottleInventoryItem = {
  id: string
  materialId: string
  materialName: string
  materialStatus: InventoryStatus
  code: number
  dilution: string
  status: InventoryStatus
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

type MaterialListResult = {
  items: MaterialInventoryItem[]
}

type BottleListResult = {
  items: BottleInventoryItem[]
}

type GeneratedBottleCodeResult = {
  code: number
  remainingAssignableCodes: number
}

type MaterialFormState = {
  id: string | null
  name: string
  status: InventoryStatus
}

type BottleFormState = {
  id: string | null
  materialId: string
  code: string
  dilution: string
  status: InventoryStatus
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function InventoryView({ hasTauriRuntime }: InventoryViewProps) {
  const [mode, setMode] = useState<InventoryMode>('bottles')
  const [materials, setMaterials] = useState<MaterialInventoryItem[]>([])
  const [bottles, setBottles] = useState<BottleInventoryItem[]>([])
  const [inventoryError, setInventoryError] = useState<string | null>(null)

  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all')
  const [materialQuery, setMaterialQuery] = useState('')
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null)
  const [materialForm, setMaterialForm] = useState<MaterialFormState>(
    createEmptyMaterialForm(),
  )
  const [materialBaseline, setMaterialBaseline] = useState<MaterialFormState>(
    createEmptyMaterialForm(),
  )
  const [materialNotice, setMaterialNotice] = useState<string | null>(null)
  const [materialError, setMaterialError] = useState<string | null>(null)
  const [isSavingMaterial, setIsSavingMaterial] = useState(false)
  const [isArchivingMaterial, setIsArchivingMaterial] = useState(false)

  const [bottleFilter, setBottleFilter] = useState<InventoryFilter>('all')
  const [bottleQuery, setBottleQuery] = useState('')
  const [selectedBottleId, setSelectedBottleId] = useState<string | null>(null)
  const [bottleForm, setBottleForm] = useState<BottleFormState>(createEmptyBottleForm())
  const [bottleBaseline, setBottleBaseline] = useState<BottleFormState>(
    createEmptyBottleForm(),
  )
  const [bottleNotice, setBottleNotice] = useState<string | null>(null)
  const [bottleError, setBottleError] = useState<string | null>(null)
  const [isSavingBottle, setIsSavingBottle] = useState(false)
  const [isArchivingBottle, setIsArchivingBottle] = useState(false)
  const [isGeneratingBottleCode, setIsGeneratingBottleCode] = useState(false)

  const loadInventory = useCallback(async () => {
    if (!hasTauriRuntime) {
      return
    }

    setInventoryError(null)

    try {
      const [materialsResult, bottlesResult] = await Promise.all([
        invoke<MaterialListResult>('list_inventory_materials'),
        invoke<BottleListResult>('list_inventory_bottles'),
      ])

      setMaterials(materialsResult.items)
      setBottles(bottlesResult.items)
    } catch (error) {
      setInventoryError(String(error))
    }
  }, [hasTauriRuntime])

  useEffect(() => {
    void loadInventory()
  }, [loadInventory])

  const selectedMaterial =
    materials.find((material) => material.id === selectedMaterialId) ?? null
  const selectedBottle = bottles.find((bottle) => bottle.id === selectedBottleId) ?? null

  const materialOptions = useMemo(
    () =>
      [...materials].sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === 'active' ? -1 : 1
        }

        return left.name.localeCompare(right.name)
      }),
    [materials],
  )

  const filteredMaterials = useMemo(() => {
    const query = materialQuery.trim().toLowerCase()

    return materials.filter((material) => {
      if (
        materialFilter !== 'all' &&
        materialFilter !== 'no_active_bottles' &&
        material.status !== materialFilter
      ) {
        return false
      }

      if (
        materialFilter === 'no_active_bottles' &&
        material.activeBottleCount > 0
      ) {
        return false
      }

      if (!query) {
        return true
      }

      return material.name.toLowerCase().includes(query)
    })
  }, [materialFilter, materialQuery, materials])

  const filteredBottles = useMemo(() => {
    const query = bottleQuery.trim().toLowerCase()

    return bottles.filter((bottle) => {
      if (bottleFilter !== 'all' && bottle.status !== bottleFilter) {
        return false
      }

      if (!query) {
        return true
      }

      const normalizedCode = String(bottle.code).padStart(3, '0')
      return (
        normalizedCode.includes(query) ||
        bottle.materialName.toLowerCase().includes(query) ||
        bottle.dilution.toLowerCase().includes(query)
      )
    })
  }, [bottleFilter, bottleQuery, bottles])

  const materialMetrics = useMemo(
    () => ({
      total: materials.length,
      active: materials.filter((material) => material.status === 'active').length,
      archived: materials.filter((material) => material.status === 'archived').length,
    }),
    [materials],
  )

  const bottleMetrics = useMemo(
    () => ({
      total: bottles.length,
      active: bottles.filter((bottle) => bottle.status === 'active').length,
      archived: bottles.filter((bottle) => bottle.status === 'archived').length,
    }),
    [bottles],
  )

  const codeCapacityRemaining = useMemo(() => {
    let assignableCount = 0

    for (let code = 100; code <= 999; code += 1) {
      if (isAssignableCode(code)) {
        assignableCount += 1
      }
    }

    return Math.max(0, assignableCount - bottles.length)
  }, [bottles.length])

  const materialDirty = isMaterialFormDirty(materialForm, materialBaseline)
  const bottleDirty = isBottleFormDirty(bottleForm, bottleBaseline)
  const hasUnsavedChanges = materialDirty || bottleDirty

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  function startNewMaterial() {
    const empty = createEmptyMaterialForm()
    setSelectedMaterialId(null)
    setMaterialForm(empty)
    setMaterialBaseline(empty)
    setMaterialError(null)
    setMaterialNotice(null)
  }

  function startNewBottle() {
    const empty = createEmptyBottleForm()
    setSelectedBottleId(null)
    setBottleForm(empty)
    setBottleBaseline(empty)
    setBottleError(null)
    setBottleNotice(null)
  }

  function selectMaterial(material: MaterialInventoryItem) {
    const nextForm = {
      id: material.id,
      name: material.name,
      status: material.status,
    }

    setSelectedMaterialId(material.id)
    setMaterialForm(nextForm)
    setMaterialBaseline(nextForm)
    setMaterialError(null)
    setMaterialNotice(null)
  }

  function selectBottle(bottle: BottleInventoryItem) {
    const nextForm = {
      id: bottle.id,
      materialId: bottle.materialId,
      code: String(bottle.code),
      dilution: bottle.dilution,
      status: bottle.status,
    }

    setSelectedBottleId(bottle.id)
    setBottleForm(nextForm)
    setBottleBaseline(nextForm)
    setBottleError(null)
    setBottleNotice(null)
  }

  async function handleSaveMaterial() {
    if (!hasTauriRuntime) {
      setMaterialError('Inventory editing is only available inside the Tauri desktop runtime.')
      return
    }

    setIsSavingMaterial(true)
    setMaterialError(null)
    setMaterialNotice(null)

    try {
      const savedMaterial = materialForm.id
        ? await invoke<MaterialInventoryItem>('update_inventory_material', {
            materialId: materialForm.id,
            name: materialForm.name,
            status: materialForm.status,
          })
        : await invoke<MaterialInventoryItem>('create_inventory_material', {
            name: materialForm.name,
          })

      await loadInventory()
      selectMaterial(savedMaterial)
      setMode('materials')
      setMaterialNotice(materialForm.id ? 'Material updated.' : 'Material created.')
    } catch (error) {
      setMaterialError(String(error))
    } finally {
      setIsSavingMaterial(false)
    }
  }

  async function handleToggleMaterialStatus(nextStatus: InventoryStatus) {
    if (!materialForm.id) {
      setMaterialError('Select a material before changing its archived state.')
      return
    }

    setIsArchivingMaterial(true)
    setMaterialError(null)
    setMaterialNotice(null)

    try {
      const updatedMaterial = await invoke<MaterialInventoryItem>(
        'update_inventory_material',
        {
          materialId: materialForm.id,
          name: materialForm.name,
          status: nextStatus,
        },
      )

      await loadInventory()
      selectMaterial(updatedMaterial)
      setMaterialNotice(
        nextStatus === 'archived' ? 'Material archived.' : 'Material unarchived.',
      )
    } catch (error) {
      setMaterialError(String(error))
    } finally {
      setIsArchivingMaterial(false)
    }
  }

  async function handleGenerateBottleCode() {
    if (!hasTauriRuntime) {
      setBottleError('Code generation is only available inside the Tauri desktop runtime.')
      return
    }

    setIsGeneratingBottleCode(true)
    setBottleError(null)
    setBottleNotice(null)

    try {
      const generated = await invoke<GeneratedBottleCodeResult>(
        'generate_inventory_bottle_code',
      )
      setBottleForm((current) => ({
        ...current,
        code: String(generated.code),
      }))
      setBottleNotice(
        `${String(generated.code).padStart(3, '0')} reserved in form. ${generated.remainingAssignableCodes} assignable codes remain after this pick.`,
      )
    } catch (error) {
      setBottleError(String(error))
    } finally {
      setIsGeneratingBottleCode(false)
    }
  }

  async function handleSaveBottle() {
    if (!hasTauriRuntime) {
      setBottleError('Inventory editing is only available inside the Tauri desktop runtime.')
      return
    }

    setIsSavingBottle(true)
    setBottleError(null)
    setBottleNotice(null)

    try {
      const parsedCode = Number.parseInt(bottleForm.code, 10)
      const savedBottle = bottleForm.id
        ? await invoke<BottleInventoryItem>('update_inventory_bottle', {
            bottleId: bottleForm.id,
            materialId: bottleForm.materialId,
            code: parsedCode,
            dilution: bottleForm.dilution,
            status: bottleForm.status,
          })
        : await invoke<BottleInventoryItem>('create_inventory_bottle', {
            materialId: bottleForm.materialId,
            code: parsedCode,
            dilution: bottleForm.dilution,
          })

      await loadInventory()
      selectBottle(savedBottle)
      setMode('bottles')
      setBottleNotice(bottleForm.id ? 'Bottle updated.' : 'Bottle created.')
    } catch (error) {
      setBottleError(String(error))
    } finally {
      setIsSavingBottle(false)
    }
  }

  async function handleToggleBottleStatus(nextStatus: InventoryStatus) {
    if (!bottleForm.id) {
      setBottleError('Select a bottle before changing its archived state.')
      return
    }

    setIsArchivingBottle(true)
    setBottleError(null)
    setBottleNotice(null)

    try {
      const parsedCode = Number.parseInt(bottleForm.code, 10)
      const updatedBottle = await invoke<BottleInventoryItem>('update_inventory_bottle', {
        bottleId: bottleForm.id,
        materialId: bottleForm.materialId,
        code: parsedCode,
        dilution: bottleForm.dilution,
        status: nextStatus,
      })
      await loadInventory()
      selectBottle(updatedBottle)
      setBottleNotice(nextStatus === 'archived' ? 'Bottle archived.' : 'Bottle unarchived.')
    } catch (error) {
      setBottleError(String(error))
    } finally {
      setIsArchivingBottle(false)
    }
  }

  return (
    <section className="static-route inventory-route">
      <header className="route-header inventory-header">
        <div className="route-heading-group">
          <p className="panel-label accent-copy">PRIVATE REGISTRY</p>
          <h2 className="session-title route-title">02_INVENTORY</h2>
        </div>
      </header>

      <section className="inventory-summary-grid" aria-label="Inventory summary">
        <article className="inventory-summary-card">
          <span className="inventory-summary-id">ID: INV_MAT</span>
          <strong className="inventory-summary-value">{materialMetrics.active}</strong>
          <p className="inventory-summary-label">MATERIAL_LIBRARY</p>
        </article>
        <article className="inventory-summary-card">
          <span className="inventory-summary-id">ID: INV_BTL</span>
          <strong className="inventory-summary-value">{bottleMetrics.active}</strong>
          <p className="inventory-summary-label">BOTTLE_REGISTRY</p>
        </article>
        <article className="inventory-summary-card">
          <span className="inventory-summary-id">ID: INV_CAP</span>
          <strong className="inventory-summary-value">{codeCapacityRemaining}</strong>
          <p className="inventory-summary-label">CODE_CAPACITY</p>
        </article>
      </section>

      <div className="inventory-toolbar inventory-toolbar-wide">
        <div
          aria-label="Inventory section switcher"
          className="inventory-segmented-control"
          role="tablist"
        >
          <button
            aria-selected={mode === 'bottles'}
            className={`inventory-segment${mode === 'bottles' ? ' is-active' : ''}`}
            onClick={() => setMode('bottles')}
            role="tab"
            type="button"
          >
            Bottles
          </button>
          <button
            aria-selected={mode === 'materials'}
            className={`inventory-segment${mode === 'materials' ? ' is-active' : ''}`}
            onClick={() => setMode('materials')}
            role="tab"
            type="button"
          >
            Materials
          </button>
        </div>

        <div className="inventory-toolbar-actions">
          {mode === 'materials' ? (
            <button className="primary-action" onClick={startNewMaterial} type="button">
              NEW MATERIAL
            </button>
          ) : (
            <button className="primary-action" onClick={startNewBottle} type="button">
              NEW BOTTLE
            </button>
          )}
        </div>
      </div>

      <section className="inventory-workspace">
        <div className="inventory-main-panel">
          {mode === 'materials' ? (
            <section className="panel inventory-table-panel">
              <div className="inventory-table-toolbar">
                <label className="inventory-filter-field">
                  <span className="field-label">Search</span>
                  <ClearableInput
                    className="text-input"
                    clearLabel="Clear material inventory search"
                    name="materialQuery"
                    onChange={setMaterialQuery}
                    placeholder="Search materials…"
                    value={materialQuery}
                  />
                </label>
                <label className="inventory-filter-field">
                  <span className="field-label">Status</span>
                  <select
                    className="text-input select-input"
                    name="materialStatusFilter"
                    onChange={(event) =>
                      setMaterialFilter(event.target.value as MaterialFilter)
                    }
                    value={materialFilter}
                  >
                    <option value="all">all</option>
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                    <option value="no_active_bottles">no active bottles</option>
                  </select>
                </label>
              </div>

              <div className="data-table inventory-table" role="table" aria-label="Materials">
                <div className="table-row table-head inventory-grid inventory-grid-materials">
                  <span>Name</span>
                  <span>Linked Bottles</span>
                  <span>Attempts</span>
                  <span>Status</span>
                </div>
                {filteredMaterials.map((material) => (
                  <button
                    key={material.id}
                    className={`table-row inventory-grid inventory-grid-materials inventory-table-row${
                      selectedMaterialId === material.id ? ' is-selected' : ''
                    }`}
                    onClick={() => selectMaterial(material)}
                    type="button"
                  >
                    <span className="inventory-primary-text">{material.name}</span>
                    <span>
                      {material.activeBottleCount} active / {material.archivedBottleCount}{' '}
                      archived
                    </span>
                    <span>{material.attemptCount}</span>
                    <span>
                      <span className={`status-chip ${statusChipClass(material.status)}`}>
                        {material.status}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {filteredMaterials.length === 0 ? (
                <p className="sidebar-copy compact-copy">
                  No materials match the current filters.
                </p>
              ) : null}
            </section>
          ) : (
            <section className="panel inventory-table-panel">
              <div className="inventory-table-toolbar">
                <label className="inventory-filter-field">
                  <span className="field-label">Search</span>
                  <ClearableInput
                    className="text-input"
                    clearLabel="Clear bottle inventory search"
                    name="bottleQuery"
                    onChange={setBottleQuery}
                    placeholder="Search code, material, dilution…"
                    value={bottleQuery}
                  />
                </label>
                <label className="inventory-filter-field">
                  <span className="field-label">Status</span>
                  <select
                    className="text-input select-input"
                    name="bottleStatusFilter"
                    onChange={(event) =>
                      setBottleFilter(event.target.value as InventoryFilter)
                    }
                    value={bottleFilter}
                  >
                    <option value="all">all</option>
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                </label>
              </div>

              <div className="data-table inventory-table" role="table" aria-label="Bottles">
                <div className="table-row table-head inventory-grid inventory-grid-bottles">
                  <span>Code</span>
                  <span>Material</span>
                  <span>Dilution</span>
                  <span>Status</span>
                </div>
                {filteredBottles.map((bottle) => (
                  <button
                    key={bottle.id}
                    className={`table-row inventory-grid inventory-grid-bottles inventory-table-row${
                      selectedBottleId === bottle.id ? ' is-selected' : ''
                    }`}
                    onClick={() => selectBottle(bottle)}
                    type="button"
                  >
                    <span className="inventory-code">{String(bottle.code).padStart(3, '0')}</span>
                    <span className="inventory-primary-text">{bottle.materialName}</span>
                    <span className="inventory-secondary-text">{bottle.dilution}</span>
                    <span>
                      <span className={`status-chip ${statusChipClass(bottle.status)}`}>
                        {bottle.status}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {filteredBottles.length === 0 ? (
                <p className="sidebar-copy compact-copy">
                  No bottles match the current filters.
                </p>
              ) : null}
            </section>
          )}

          {inventoryError ? <p className="status-error">{inventoryError}</p> : null}
          {!hasTauriRuntime ? (
            <p className="status-error">
              Inventory CRUD is only available inside the Tauri desktop runtime.
            </p>
          ) : null}
        </div>

        <aside className="inventory-form-column">
          <div className="panel inventory-form-panel">
            {mode === 'materials' ? (
              <>
              <div className="inventory-form-header">
                <div>
                  <p className="panel-label accent-copy">
                    {materialForm.id ? 'EDIT MATERIAL' : 'NEW MATERIAL'}
                  </p>
                  <h3 className="topbar-title">Material Registry</h3>
                </div>
                <button className="text-button" onClick={startNewMaterial} type="button">
                  CLEAR
                </button>
              </div>

              <label className="inventory-filter-field">
                <span className="field-label">Name</span>
                <input
                  className="text-input"
                  name="materialName"
                  onChange={(event) =>
                    setMaterialForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Iso E Super…"
                  type="text"
                  value={materialForm.name}
                />
              </label>

              <label className="inventory-filter-field">
                <span className="field-label">Status</span>
                <select
                  className="text-input select-input"
                  name="materialStatus"
                  onChange={(event) =>
                    setMaterialForm((current) => ({
                      ...current,
                      status: event.target.value as InventoryStatus,
                    }))
                  }
                  value={materialForm.status}
                >
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </label>

              {selectedMaterial ? (
                <dl className="summary-grid">
                  <div>
                    <dt>ACTIVE BOTTLES</dt>
                    <dd>{selectedMaterial.activeBottleCount}</dd>
                  </div>
                  <div>
                    <dt>ARCHIVED BOTTLES</dt>
                    <dd>{selectedMaterial.archivedBottleCount}</dd>
                  </div>
                  <div>
                    <dt>ATTEMPTS</dt>
                    <dd>{selectedMaterial.attemptCount}</dd>
                  </div>
                  <div>
                    <dt>UPDATED</dt>
                    <dd>{formatInventoryDate(selectedMaterial.updatedAt)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="sidebar-copy compact-copy">
                  Create a canonical material name first, then attach bottles to it in
                  the bottle view.
                </p>
              )}

              <div className="inventory-form-actions">
                <button
                  className="secondary-action"
                  disabled={!materialForm.id || isArchivingMaterial}
                  onClick={() => {
                    void handleToggleMaterialStatus(
                      materialForm.status === 'archived' ? 'active' : 'archived',
                    )
                  }}
                  type="button"
                >
                  {isArchivingMaterial
                    ? materialForm.status === 'archived'
                      ? 'UNARCHIVING…'
                      : 'ARCHIVING…'
                    : materialForm.status === 'archived'
                      ? 'UNARCHIVE'
                      : 'ARCHIVE'}
                </button>
                <button
                  className="primary-action"
                  disabled={!hasTauriRuntime || isSavingMaterial}
                  onClick={() => {
                    void handleSaveMaterial()
                  }}
                  type="button"
                >
                  {isSavingMaterial ? 'SAVING…' : 'SAVE MATERIAL'}
                </button>
              </div>

              <div className="session-status-block" aria-live="polite">
                <p className="panel-label">Material status</p>
                {materialNotice ? (
                  <p className="import-success-copy">{materialNotice}</p>
                ) : (
                  <p className="sidebar-copy compact-copy">
                    Material names are normalized for uniqueness. Archiving is blocked
                    while active bottles still point at the material.
                  </p>
                )}
                {materialError ? <p className="status-error">{materialError}</p> : null}
              </div>
              </>
            ) : (
              <>
              <div className="inventory-form-header">
                <div>
                  <p className="panel-label accent-copy">
                    {bottleForm.id ? 'EDIT BOTTLE' : 'NEW BOTTLE'}
                  </p>
                  <h3 className="topbar-title">Bottle Registry</h3>
                </div>
                <button className="text-button" onClick={startNewBottle} type="button">
                  CLEAR
                </button>
              </div>

              <label className="inventory-filter-field">
                <span className="field-label">Material</span>
                <select
                  className="text-input select-input"
                  name="bottleMaterial"
                  onChange={(event) =>
                    setBottleForm((current) => ({
                      ...current,
                      materialId: event.target.value,
                    }))
                  }
                  value={bottleForm.materialId}
                >
                  <option value="">Select material…</option>
                  {materialOptions.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name}
                      {material.status === 'archived' ? ' [archived]' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="inventory-inline-fields">
                <label className="inventory-filter-field">
                  <span className="field-label">Code</span>
                  <input
                    className="text-input"
                    inputMode="numeric"
                    maxLength={3}
                    name="bottleCode"
                    onChange={(event) =>
                      setBottleForm((current) => ({
                        ...current,
                        code: event.target.value.replace(/\D+/g, '').slice(0, 3),
                      }))
                    }
                    placeholder="104"
                    type="text"
                    value={bottleForm.code}
                  />
                </label>
                <button
                  className="secondary-action inventory-inline-action"
                  disabled={!hasTauriRuntime || isGeneratingBottleCode}
                  onClick={() => {
                    void handleGenerateBottleCode()
                  }}
                  type="button"
                >
                  {isGeneratingBottleCode ? 'GENERATING…' : 'GENERATE'}
                </button>
              </div>

              <label className="inventory-filter-field">
                <span className="field-label">Dilution</span>
                <input
                  className="text-input"
                  name="bottleDilution"
                  onChange={(event) =>
                    setBottleForm((current) => ({
                      ...current,
                      dilution: event.target.value,
                    }))
                  }
                  placeholder="10% in DPG…"
                  type="text"
                  value={bottleForm.dilution}
                />
              </label>

              <label className="inventory-filter-field">
                <span className="field-label">Status</span>
                <select
                  className="text-input select-input"
                  name="bottleStatus"
                  onChange={(event) =>
                    setBottleForm((current) => ({
                      ...current,
                      status: event.target.value as InventoryStatus,
                    }))
                  }
                  value={bottleForm.status}
                >
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </label>

              {selectedBottle ? (
                <dl className="summary-grid">
                  <div>
                    <dt>MATERIAL</dt>
                    <dd>{selectedBottle.materialName}</dd>
                  </div>
                  <div>
                    <dt>MATERIAL STATUS</dt>
                    <dd>{selectedBottle.materialStatus}</dd>
                  </div>
                  <div>
                    <dt>UPDATED</dt>
                    <dd>{formatInventoryDate(selectedBottle.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>ARCHIVED AT</dt>
                    <dd>
                      {selectedBottle.archivedAt
                        ? formatInventoryDate(selectedBottle.archivedAt)
                        : 'Not archived'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="sidebar-copy compact-copy">
                  Bottles require a material, a unique 3-digit code, and a dilution
                  label. Use Generate to avoid obvious patterns.
                </p>
              )}

              <div className="inventory-form-actions">
                <button
                  className="secondary-action"
                  disabled={!bottleForm.id || isArchivingBottle}
                  onClick={() => {
                    void handleToggleBottleStatus(
                      bottleForm.status === 'archived' ? 'active' : 'archived',
                    )
                  }}
                  type="button"
                >
                  {isArchivingBottle
                    ? bottleForm.status === 'archived'
                      ? 'UNARCHIVING…'
                      : 'ARCHIVING…'
                    : bottleForm.status === 'archived'
                      ? 'UNARCHIVE'
                      : 'ARCHIVE'}
                </button>
                <button
                  className="primary-action"
                  disabled={!hasTauriRuntime || isSavingBottle}
                  onClick={() => {
                    void handleSaveBottle()
                  }}
                  type="button"
                >
                  {isSavingBottle ? 'SAVING…' : 'SAVE BOTTLE'}
                </button>
              </div>

              <div className="session-status-block" aria-live="polite">
                <p className="panel-label">Bottle status</p>
                {bottleNotice ? (
                  <p className="import-success-copy">{bottleNotice}</p>
                ) : (
                  <p className="sidebar-copy compact-copy">
                    Archived codes remain reserved forever. Material assignment changes
                    are written to the bottle audit trail.
                  </p>
                )}
                {bottleError ? <p className="status-error">{bottleError}</p> : null}
              </div>
              </>
            )}
          </div>
        </aside>
      </section>
    </section>
  )
}

function createEmptyMaterialForm(): MaterialFormState {
  return {
    id: null,
    name: '',
    status: 'active',
  }
}

function createEmptyBottleForm(): BottleFormState {
  return {
    id: null,
    materialId: '',
    code: '',
    dilution: '',
    status: 'active',
  }
}

function isMaterialFormDirty(current: MaterialFormState, baseline: MaterialFormState) {
  return JSON.stringify(current) !== JSON.stringify(baseline)
}

function isBottleFormDirty(current: BottleFormState, baseline: BottleFormState) {
  return JSON.stringify(current) !== JSON.stringify(baseline)
}

function formatInventoryDate(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function isAssignableCode(code: number) {
  const hundreds = Math.floor(code / 100)
  const tens = Math.floor((code % 100) / 10)
  const ones = code % 10

  if (hundreds === tens && tens === ones) {
    return false
  }

  if (tens === hundreds + 1 && ones === tens + 1) {
    return false
  }

  if (tens === hundreds - 1 && ones === tens - 1) {
    return false
  }

  return true
}

function statusChipClass(status: InventoryStatus) {
  return status === 'active' ? 'is-success' : 'is-neutral'
}
