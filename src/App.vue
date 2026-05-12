<script setup>
import { mdiClose, mdiContentSaveOutline, mdiDeleteOutline, mdiInformationOutline, mdiPencilOutline, mdiPlus } from '@mdi/js'
import Sortable from 'sortablejs'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

const DEFAULT_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/7/7e/P68l.jpg'
const VISUAL_RANKS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
const RESEARCH_COLUMN_WIDTH = 292
const PREMIUM_COLUMNS = 2
const PREMIUM_COLUMN_WIDTH = RESEARCH_COLUMN_WIDTH * PREMIUM_COLUMNS + RESEARCH_COLUMN_GAP * (PREMIUM_COLUMNS - 1) + 40
const RESEARCH_COLUMN_GAP = 16
const RESEARCH_LEFT_OFFSET = 84
const RESEARCH_RIGHT_OFFSET = 20
const VEHICLE_CATEGORY_OPTIONS = [
  { id: 'ground', label: 'Наземная техника' },
  { id: 'aviation', label: 'Авиация' },
  { id: 'helicopters', label: 'Вертолеты' },
  { id: 'bluewater', label: 'Большой флот' },
  { id: 'coastal', label: 'Малый флот' }
]
const icons = {
  edit: mdiPencilOutline,
  delete: mdiDeleteOutline,
  info: mdiInformationOutline,
  close: mdiClose,
  add: mdiPlus,
  save: mdiContentSaveOutline
}

const tree = ref({
  activeTreeId: '',
  activeVehicleCategory: 'ground',
  trees: [],
  branches: [],
  units: []
})

const loading = ref(true)
const boardBusy = ref(false)
const error = ref('')
const savingTitle = ref(false)
const lightboxUnit = ref(null)
const lightboxIndex = ref(0)
const confirmAction = ref(null)
const dragState = reactive({
  unitId: '',
  overKey: '',
  pending: false
})
const loadedImages = reactive({})
const treeStripRef = ref(null)
const categoryStripRef = ref(null)
const sortableContainers = new Map()
const sortableInstances = new Map()
const stripFadeState = reactive({
  treesLeft: false,
  treesRight: false,
  categoriesLeft: false,
  categoriesRight: false
})

const isDragging = computed(() => Boolean(dragState.unitId))

const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  confirmText: 'Подтвердить',
  pending: false
})

const branchForm = reactive({
  name: '',
  type: 'research'
})

const fanTreeForm = reactive({
  name: '',
  flagUrl: ''
})

const categoryForm = reactive({
  vehicleCategory: 'helicopters'
})

const activeTreeForm = reactive({
  name: '',
  flagUrl: ''
})

const unitForm = reactive({
  branchId: '',
  name: '',
  rank: '',
  rankTier: '1',
  imageUrls: [DEFAULT_IMAGE_URL]
})

const branchEditor = reactive({
  open: false,
  id: '',
  name: '',
  type: 'research',
  vehicleCategory: 'ground',
  saving: false
})

const unitEditor = reactive({
  open: false,
  id: '',
  branchId: '',
  name: '',
  rank: '',
  rankTier: '1',
  imageUrls: [DEFAULT_IMAGE_URL],
  saving: false
})

const infoEditor = reactive({
  open: false,
  id: '',
  name: '',
  description: '',
  links: [],
  editing: false,
  saving: false
})

const orderedTrees = computed(() => [...tree.value.trees].sort((a, b) => a.order - b.order))
const activeTree = computed(() => orderedTrees.value.find((item) => item.id === tree.value.activeTreeId) || orderedTrees.value[0] || null)
const activeVehicleCategory = computed(() => tree.value.activeVehicleCategory || 'ground')
const activeTreeCategories = computed(() => {
  const enabled = activeTree.value?.enabledCategories || ['ground', 'aviation']
  return VEHICLE_CATEGORY_OPTIONS.filter((option) => enabled.includes(option.id))
})
const addableVehicleCategories = computed(() => {
  const enabled = new Set(activeTree.value?.enabledCategories || [])
  return VEHICLE_CATEGORY_OPTIONS.filter((option) => !enabled.has(option.id))
})
const activeVehicleCategoryLabel = computed(() => {
  return VEHICLE_CATEGORY_OPTIONS.find((option) => option.id === activeVehicleCategory.value)?.label || 'Раздел техники'
})
const orderedBranches = computed(() => {
  return [...tree.value.branches]
    .filter((branch) => branch.treeId === tree.value.activeTreeId && branch.vehicleCategory === activeVehicleCategory.value)
    .sort((a, b) => a.order - b.order)
})
const researchBranches = computed(() => orderedBranches.value.filter((branch) => branch.type === 'research'))
const premiumBranches = computed(() => orderedBranches.value.filter((branch) => branch.type === 'premium'))
const activeBranchIds = computed(() => new Set(orderedBranches.value.map((branch) => branch.id)))
const activeUnits = computed(() => tree.value.units.filter((unit) => activeBranchIds.value.has(unit.branchId)))
const researchGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${researchBranches.value.length}, ${RESEARCH_COLUMN_WIDTH}px)`
}))
const premiumGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${PREMIUM_COLUMNS}, ${RESEARCH_COLUMN_WIDTH}px)`
}))
const researchAreaWidth = computed(() => {
  const columns = researchBranches.value.length * RESEARCH_COLUMN_WIDTH
  const gaps = Math.max(researchBranches.value.length - 1, 0) * RESEARCH_COLUMN_GAP
  return Math.max(columns + gaps + RESEARCH_LEFT_OFFSET + RESEARCH_RIGHT_OFFSET, 760)
})
const boardMinWidth = computed(() => `${Math.max(researchAreaWidth.value + PREMIUM_COLUMN_WIDTH, 1560)}px`)
const boardGridStyle = computed(() => ({
  minWidth: boardMinWidth.value,
  gridTemplateColumns: `minmax(${researchAreaWidth.value}px, 1fr) ${PREMIUM_COLUMN_WIDTH}px`
}))

const unitsByBranch = computed(() => {
  return tree.value.units.reduce((map, unit) => {
    map[unit.branchId] ??= []
    map[unit.branchId].push(unit)
    map[unit.branchId].sort((a, b) => a.order - b.order)
    return map
  }, {})
})

const rankSummary = computed(() => {
  const values = activeUnits.value.map((unit) => Number(unit.rank)).filter((rank) => Number.isFinite(rank))
  if (!values.length) {
    return 'Пока нет техники'
  }

  return `BR ${Math.min(...values).toFixed(1)} - ${Math.max(...values).toFixed(1)}`
})

const rankBands = computed(() => VISUAL_RANKS.map((_, index) => index + 1))

async function fetchTree() {
  loading.value = true
  error.value = ''

  try {
    const response = await fetch('/api/tree')
    if (!response.ok) {
      throw new Error(await getErrorMessage(response, 'Не удалось загрузить данные'))
    }

    applyTree(await response.json())
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function applyTree(data) {
  tree.value = data
  activeTreeForm.name = activeTree.value?.name || ''
  activeTreeForm.flagUrl = activeTree.value?.flagUrl || ''
  for (const unit of tree.value.units) {
    if (loadedImages[unit.id] === undefined) {
      loadedImages[unit.id] = false
    }
  }
  if (addableVehicleCategories.value.length && !addableVehicleCategories.value.some((option) => option.id === categoryForm.vehicleCategory)) {
    categoryForm.vehicleCategory = addableVehicleCategories.value[0].id
  }

  if (!orderedBranches.value.some((branch) => branch.id === unitForm.branchId)) {
    unitForm.branchId = orderedBranches.value[0]?.id || ''
  }

  if (branchEditor.open && !tree.value.branches.some((branch) => branch.id === branchEditor.id)) {
    closeBranchEditor()
  }

  if (unitEditor.open && !tree.value.units.some((unit) => unit.id === unitEditor.id)) {
    closeUnitEditor()
  }

  if (infoEditor.open && !tree.value.units.some((unit) => unit.id === infoEditor.id)) {
    closeInfoEditor()
  }

  syncHeaderStripFade()
  initSortables()
}

function normalizeImageUrls(imageUrls, fallback = DEFAULT_IMAGE_URL) {
  const normalized = (Array.isArray(imageUrls) ? imageUrls : [imageUrls])
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  return normalized.length ? normalized : [fallback]
}

function primaryImage(unit) {
  return normalizeImageUrls(unit.imageUrls, DEFAULT_IMAGE_URL)[0]
}

function unitImages(unit) {
  return normalizeImageUrls(unit.imageUrls, DEFAULT_IMAGE_URL)
}

function addImageUrl(target) {
  target.imageUrls.push('')
}

function removeImageUrl(target, index) {
  target.imageUrls.splice(index, 1)
  if (!target.imageUrls.length) {
    target.imageUrls.push('')
  }
}

function hasInfoContent(unit) {
  return Boolean((unit.description || '').trim() || (unit.links || []).length)
}

async function getErrorMessage(response, fallback) {
  try {
    const payload = await response.json()
    return payload?.error || fallback
  } catch {
    return fallback
  }
}

async function runBoardMutation(task) {
  boardBusy.value = true
  try {
    return await task()
  } finally {
    boardBusy.value = false
  }
}

async function saveActiveTree() {
  if (!activeTree.value) {
    return
  }

  savingTitle.value = true

  try {
    const response = await fetch(`/api/trees/${activeTree.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: activeTreeForm.name,
        flagUrl: activeTreeForm.flagUrl
      })
    })

    if (!response.ok) {
      throw new Error(await getErrorMessage(response, 'Не удалось сохранить фан-дерево'))
    }

    applyTree(await response.json())
  } catch (err) {
    error.value = err.message
  } finally {
    savingTitle.value = false
  }
}

async function createFanTree() {
  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch('/api/trees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fanTreeForm)
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось создать фан-дерево'))
      }

      applyTree(await response.json())
    })
    fanTreeForm.name = ''
    fanTreeForm.flagUrl = ''
  } catch (err) {
    error.value = err.message
  }
}

async function switchActiveTree(treeId) {
  await switchActiveContext(treeId, activeVehicleCategory.value)
}

function editFanTree(treeId) {
  switchActiveTree(treeId)
}

function requestDeleteFanTree(fanTree) {
  openConfirm({
    title: 'Удалить фан-дерево?',
    message: `Фан-дерево "${fanTree.name}" будет удалено вместе со всеми линейками и карточками техники.`,
    confirmText: 'Удалить фан-дерево',
    action: async () => {
      await runBoardMutation(async () => {
        const response = await fetch(`/api/trees/${fanTree.id}`, { method: 'DELETE' })
        if (!response.ok) {
          throw new Error(await getErrorMessage(response, 'Не удалось удалить фан-дерево'))
        }

        applyTree(await response.json())
      })
    }
  })
}

async function switchVehicleCategory(vehicleCategory) {
  await switchActiveContext(tree.value.activeTreeId, vehicleCategory)
}

async function addVehicleCategory() {
  if (!activeTree.value) {
    return
  }

  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch(`/api/trees/${activeTree.value.id}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleCategory: categoryForm.vehicleCategory })
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось добавить раздел техники'))
      }

      applyTree(await response.json())
    })
    await switchVehicleCategory(categoryForm.vehicleCategory)
  } catch (err) {
    error.value = err.message
  }
}

async function switchActiveContext(treeId, vehicleCategory) {
  error.value = ''
  boardBusy.value = true

  try {
    const response = await fetch('/api/active', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ treeId, vehicleCategory })
    })

    if (!response.ok) {
      throw new Error(await getErrorMessage(response, 'Не удалось переключить контекст'))
    }

    applyTree(await response.json())
  } catch (err) {
    error.value = err.message
  } finally {
    boardBusy.value = false
  }
}

async function createBranch() {
  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...branchForm,
          treeId: tree.value.activeTreeId,
          vehicleCategory: activeVehicleCategory.value
        })
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось создать ветку'))
      }

      applyTree(await response.json())
    })
    branchForm.name = ''
    unitForm.branchId = orderedBranches.value.at(-1)?.id || unitForm.branchId
  } catch (err) {
    error.value = err.message
  }
}

async function createUnit() {
  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: unitForm.branchId,
          name: unitForm.name,
          rank: unitForm.rank,
          rankTier: unitForm.rankTier,
          imageUrls: normalizeImageUrls(unitForm.imageUrls)
        })
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось добавить технику'))
      }

      applyTree(await response.json())
    })
    unitForm.name = ''
    unitForm.rank = ''
    unitForm.rankTier = '1'
    unitForm.imageUrls = [DEFAULT_IMAGE_URL]
  } catch (err) {
    error.value = err.message
  }
}

function openBranchEditor(branch) {
  branchEditor.open = true
  branchEditor.id = branch.id
  branchEditor.name = branch.name
  branchEditor.type = branch.type
  branchEditor.vehicleCategory = branch.vehicleCategory
}

function closeBranchEditor() {
  branchEditor.open = false
  branchEditor.id = ''
  branchEditor.name = ''
  branchEditor.type = 'research'
  branchEditor.vehicleCategory = 'ground'
  branchEditor.saving = false
}

async function saveBranchEditor() {
  branchEditor.saving = true
  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch(`/api/branches/${branchEditor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: branchEditor.name,
          type: branchEditor.type,
          vehicleCategory: branchEditor.vehicleCategory
        })
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось обновить ветку'))
      }

      applyTree(await response.json())
    })
    closeBranchEditor()
  } catch (err) {
    error.value = err.message
  } finally {
    branchEditor.saving = false
  }
}

function openUnitEditor(unit) {
  unitEditor.open = true
  unitEditor.id = unit.id
  unitEditor.branchId = unit.branchId
  unitEditor.name = unit.name
  unitEditor.rank = String(unit.rank)
  unitEditor.rankTier = String(unit.rankTier || 1)
  unitEditor.imageUrls = [...unitImages(unit)]
}

function closeUnitEditor() {
  unitEditor.open = false
  unitEditor.id = ''
  unitEditor.branchId = ''
  unitEditor.name = ''
  unitEditor.rank = ''
  unitEditor.rankTier = '1'
  unitEditor.imageUrls = [DEFAULT_IMAGE_URL]
  unitEditor.saving = false
}

function openInfoEditor(unit) {
  infoEditor.open = true
  infoEditor.id = unit.id
  infoEditor.name = unit.name
  infoEditor.description = unit.description || ''
  infoEditor.links = normalizeInfoLinks(unit.links)
  infoEditor.editing = !hasInfoContent(unit)
}

function closeInfoEditor() {
  infoEditor.open = false
  infoEditor.id = ''
  infoEditor.name = ''
  infoEditor.description = ''
  infoEditor.links = []
  infoEditor.editing = false
  infoEditor.saving = false
}

function normalizeInfoLinks(links) {
  if (!Array.isArray(links) || !links.length) {
    return [{ label: '', url: '' }]
  }

  return links.map((link) => ({
    label: link.label || '',
    url: link.url || ''
  }))
}

function addInfoLink() {
  infoEditor.links.push({ label: '', url: '' })
}

function removeInfoLink(index) {
  infoEditor.links.splice(index, 1)
  if (!infoEditor.links.length) {
    addInfoLink()
  }
}

async function saveInfoEditor() {
  infoEditor.saving = true
  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch(`/api/units/${infoEditor.id}/info`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: infoEditor.description,
          links: infoEditor.links
        })
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось сохранить информацию'))
      }

      applyTree(await response.json())
    })
    closeInfoEditor()
  } catch (err) {
    error.value = err.message
  } finally {
    infoEditor.saving = false
  }
}

async function saveUnitEditor() {
  unitEditor.saving = true
  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch(`/api/units/${unitEditor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: unitEditor.branchId,
          name: unitEditor.name,
          rank: unitEditor.rank,
          rankTier: unitEditor.rankTier,
          imageUrls: normalizeImageUrls(unitEditor.imageUrls)
        })
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось обновить технику'))
      }

      applyTree(await response.json())
    })
    closeUnitEditor()
  } catch (err) {
    error.value = err.message
  } finally {
    unitEditor.saving = false
  }
}

function requestDeleteBranch(branch) {
  const unitsCount = (unitsByBranch.value[branch.id] || []).length
  openConfirm({
    title: 'Удалить ветку?',
    message: `Ветка "${branch.name}" и ${unitsCount} карточек техники будут удалены безвозвратно.`,
    confirmText: 'Удалить ветку',
    action: async () => {
      await runBoardMutation(async () => {
        const response = await fetch(`/api/branches/${branch.id}`, { method: 'DELETE' })
        if (!response.ok) {
          throw new Error(await getErrorMessage(response, 'Не удалось удалить ветку'))
        }

        applyTree(await response.json())
      })
    }
  })
}

function requestDeleteUnit(unit) {
  openConfirm({
    title: 'Удалить технику?',
    message: `Карточка "${unit.name}" будет удалена.`,
    confirmText: 'Удалить карточку',
    action: async () => {
      await runBoardMutation(async () => {
        const response = await fetch(`/api/units/${unit.id}`, { method: 'DELETE' })
        if (!response.ok) {
          throw new Error(await getErrorMessage(response, 'Не удалось удалить технику'))
        }

        applyTree(await response.json())
      })
    }
  })
}

function openConfirm({ title, message, confirmText, action }) {
  confirmState.open = true
  confirmState.title = title
  confirmState.message = message
  confirmState.confirmText = confirmText
  confirmState.pending = false
  confirmAction.value = action
}

function closeConfirm() {
  if (confirmState.pending) {
    return
  }

  confirmState.open = false
  confirmState.title = ''
  confirmState.message = ''
  confirmState.confirmText = 'Подтвердить'
  confirmAction.value = null
}

async function runConfirm() {
  if (!confirmAction.value) {
    return
  }

  confirmState.pending = true
  error.value = ''
  let succeeded = false

  try {
    await confirmAction.value()
    succeeded = true
  } catch (err) {
    error.value = err.message
  } finally {
    confirmState.pending = false
    if (succeeded) {
      closeConfirm()
    }
  }
}

function branchIsEmpty(branchId) {
  return !(unitsByBranch.value[branchId] || []).length
}

function rankBand(rank) {
  const normalized = Number(rank)
  return Number.isFinite(normalized) ? Math.max(1, Math.min(VISUAL_RANKS.length, Math.round(normalized))) : 1
}

function inferRankTierFromBr(br) {
  const normalized = Number(br)
  return Number.isFinite(normalized) ? String(Math.max(1, Math.min(VISUAL_RANKS.length, Math.ceil(normalized / 2)))) : '1'
}

function syncCreateRankTierFromBr() {
  unitForm.rankTier = inferRankTierFromBr(unitForm.rank)
}

function orderedBranchUnits(branchId) {
  return unitsByBranch.value[branchId] || []
}

function bandUnits(branchId, band) {
  return orderedBranchUnits(branchId).filter((unit) => rankBand(unit.rankTier) === band)
}

function sortableListKey(branchId, band) {
  return `${branchId}-${band}`
}

function rankLabel(band) {
  return VISUAL_RANKS[band - 1] || String(band)
}

function branchBandDropBeforeUnit(branchId, band) {
  return orderedBranchUnits(branchId).find((unit) => rankBand(unit.rankTier) > band)?.id || null
}

function branchDropKey(branchId, band, slot = 'column') {
  return `${branchId}-${band}-${slot}`
}

function imageLoaded(unitId) {
  return Boolean(loadedImages[unitId])
}

function onUnitImageLoaded(unitId) {
  loadedImages[unitId] = true
}

function openLightbox(unit, index = 0) {
  lightboxUnit.value = unit
  lightboxIndex.value = index
}

function closeLightbox() {
  lightboxUnit.value = null
  lightboxIndex.value = 0
}

function nextLightboxImage() {
  if (!lightboxUnit.value) return
  lightboxIndex.value = (lightboxIndex.value + 1) % unitImages(lightboxUnit.value).length
}

function previousLightboxImage() {
  if (!lightboxUnit.value) return
  const images = unitImages(lightboxUnit.value)
  lightboxIndex.value = (lightboxIndex.value - 1 + images.length) % images.length
}

function onUnitDragStart(unit) {
  dragState.unitId = unit.id
}

function onUnitDragEnd() {
  dragState.unitId = ''
  dragState.overKey = ''
  dragState.pending = false
}

function allowDrop(event, key) {
  if (!dragState.unitId || dragState.pending) {
    return
  }

  event.preventDefault()
  dragState.overKey = key
}

function clearDrop(key) {
  if (dragState.overKey === key) {
    dragState.overKey = ''
  }
}

async function moveDraggedUnit(event, targetBranchId, beforeUnitId = null, targetRankTier = null) {
  event.preventDefault()

  if (!dragState.unitId || dragState.pending || dragState.unitId === beforeUnitId) {
    dragState.overKey = ''
    return
  }

  dragState.pending = true
  error.value = ''

  try {
    await runBoardMutation(async () => {
      const response = await fetch(`/api/units/${dragState.unitId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBranchId, beforeUnitId, targetRankTier })
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Не удалось перенести технику'))
      }

      applyTree(await response.json())
    })
  } catch (err) {
    error.value = err.message
  }
}

function handleKeydown(event) {
  if (event.key !== 'Escape') {
    return
  }

  closeLightbox()
  closeConfirm()
  closeBranchEditor()
  closeUnitEditor()
  closeInfoEditor()
}

function stripFadeClass(kind) {
  const left = kind === 'trees' ? stripFadeState.treesLeft : stripFadeState.categoriesLeft
  const right = kind === 'trees' ? stripFadeState.treesRight : stripFadeState.categoriesRight

  if (left && right) {
    return 'scroll-fade-both'
  }

  if (left) {
    return 'scroll-fade-left'
  }

  if (right) {
    return 'scroll-fade-right'
  }

  return 'scroll-fade-none'
}

function updateStripFade(kind) {
  const target = kind === 'trees' ? treeStripRef.value : categoryStripRef.value
  if (!target) {
    return
  }

  const maxScroll = Math.max(target.scrollWidth - target.clientWidth, 0)
  const left = target.scrollLeft > 4
  const right = target.scrollLeft < maxScroll - 4

  if (kind === 'trees') {
    stripFadeState.treesLeft = left
    stripFadeState.treesRight = right
    return
  }

  stripFadeState.categoriesLeft = left
  stripFadeState.categoriesRight = right
}

function syncHeaderStripFade() {
  nextTick(() => {
    updateStripFade('trees')
    updateStripFade('categories')
  })
}

function setSortableContainer(element, key) {
  if (element) {
    sortableContainers.set(key, element)
    return
  }

  sortableContainers.delete(key)
}

function destroySortables() {
  for (const sortable of sortableInstances.values()) {
    sortable.destroy()
  }

  sortableInstances.clear()
}

function initSortables() {
  nextTick(() => {
    destroySortables()

    for (const [key, element] of sortableContainers.entries()) {
      const sortable = Sortable.create(element, {
        group: 'units',
        animation: 160,
        draggable: '.sortable-unit',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        emptyInsertThreshold: 24,
        onStart: (event) => {
          dragState.unitId = event.item?.dataset.unitId || ''
        },
        onEnd: async (event) => {
          const unitId = event.item?.dataset.unitId || ''
          const targetBranchId = event.to?.dataset.branchId || ''
          const targetRankTier = Number(event.to?.dataset.rankTier || '1')

          if (!unitId || !targetBranchId) {
            onUnitDragEnd()
            return
          }

          const orderedIds = Array.from(event.to.querySelectorAll('.sortable-unit')).map((item) => item.dataset.unitId)
          const newIndex = orderedIds.indexOf(unitId)
          const beforeUnitId = newIndex >= 0 ? orderedIds[newIndex + 1] || null : null
          const sourceBranchId = event.from?.dataset.branchId || ''
          const sourceRankTier = Number(event.from?.dataset.rankTier || '1')

          if (sourceBranchId === targetBranchId && sourceRankTier === targetRankTier && event.oldIndex === event.newIndex) {
            onUnitDragEnd()
            return
          }

          try {
            await moveDraggedUnit(event, targetBranchId, beforeUnitId, targetRankTier)
          } finally {
            onUnitDragEnd()
          }
        }
      })

      sortableInstances.set(key, sortable)
    }
  })
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  fetchTree()
  window.addEventListener('resize', syncHeaderStripFade)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', syncHeaderStripFade)
  destroySortables()
})
</script>

<template>
  <div class="page-shell">
    <aside class="control-panel">
      <div class="panel-block project-block">
        <p class="panel-kicker">Редактирование дерева</p>
        <div class="sidebar-tree-head">
          <div>
            <p class="sidebar-context-label">Активное дерево</p>
            <strong class="sidebar-context-title">{{ activeTree?.name || 'Фан-дерево' }}</strong>
          </div>
          <button
            v-if="activeTree"
            class="mini-button danger icon-button"
            title="Удалить фан-дерево"
            aria-label="Удалить фан-дерево"
            @click="requestDeleteFanTree(activeTree)"
          >
            <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true">
              <path :d="icons.delete" fill="currentColor" />
            </svg>
          </button>
        </div>

        <label>
          Название активного фан-дерева
          <input
            v-model="activeTreeForm.name"
            class="title-input"
            type="text"
            placeholder="Фанатская ветка СССР"
            @blur="saveActiveTree"
          />
        </label>
        <label>
          Флаг: ссылка на картинку
          <input v-model="activeTreeForm.flagUrl" type="url" placeholder="https://..." @blur="saveActiveTree" />
        </label>
        <img v-if="activeTree?.flagUrl" :src="activeTree.flagUrl" :alt="activeTree.name" class="active-flag-preview" />

        <input
          v-if="false"
          v-model="activeTreeForm.name"
          class="title-input"
          type="text"
          placeholder="Название проекта"
          @blur="saveActiveTree"
        />
        <div class="stats-row">
          <span>{{ orderedBranches.length }} линеек</span>
          <span>{{ activeUnits.length }} карточек</span>
          <span>{{ rankSummary }}</span>
        </div>
        <button class="action-button secondary" :disabled="savingTitle" @click="saveActiveTree">
          {{ savingTitle ? 'Сохранение...' : 'Сохранить фан-дерево' }}
        </button>
      </div>

      <form class="panel-block" @submit.prevent="createFanTree">
        <div class="block-heading">
          <h2>Новое фан-дерево</h2>
          <p>Например СССР, Украина, Польша или своя нация.</p>
        </div>
        <label>
          Название
          <input v-model="fanTreeForm.name" type="text" placeholder="Фанатская ветка Украины" required />
        </label>
        <label>
          Флаг: ссылка на картинку
          <input v-model="fanTreeForm.flagUrl" type="url" placeholder="https://..." />
        </label>
        <button class="action-button primary" type="submit">Добавить фан-дерево</button>
      </form>

      <form v-if="addableVehicleCategories.length" class="panel-block" @submit.prevent="addVehicleCategory">
        <div class="block-heading">
          <h2>Новый раздел техники</h2>
          <p>По умолчанию есть наземная техника и авиация. Остальные разделы можно добавить вручную.</p>
        </div>
        <label>
          Раздел
          <select v-model="categoryForm.vehicleCategory">
            <option v-for="option in addableVehicleCategories" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <button class="action-button primary" type="submit">Добавить раздел</button>
      </form>

      <form class="panel-block" @submit.prevent="createBranch">
        <div class="block-heading">
          <h2>Новая линейка</h2>
          <p>Линейка добавится в активное фан-дерево и выбранный раздел техники.</p>
        </div>
        <label>
          Название линейки
          <input v-model="branchForm.name" type="text" placeholder="Средние танки" required />
        </label>
        <label>
          Тип линейки
          <select v-model="branchForm.type">
            <option value="research">Исследуемая</option>
            <option value="premium">Премиум / особая</option>
          </select>
        </label>
        <button class="action-button primary" type="submit">Добавить ветку</button>
      </form>

      <form class="panel-block" @submit.prevent="createUnit">
        <div class="block-heading">
          <h2>Новая техника</h2>
          <p>Карточку потом можно редактировать и перетаскивать.</p>
        </div>
        <label>
          Линейка техники
          <select v-model="unitForm.branchId" required>
            <option disabled value="">Выбери линейку</option>
            <option v-for="branch in orderedBranches" :key="branch.id" :value="branch.id">
              {{ branch.name }}
            </option>
          </select>
        </label>
        <label>
          Название
          <input v-model="unitForm.name" type="text" placeholder="T-34-57" required />
        </label>
        <label>
          Боевой ранг
          <input v-model="unitForm.rank" type="number" min="1" max="12" step="0.1" placeholder="4.7" required @input="syncCreateRankTierFromBr" />
        </label>
        <label>
          Ранг
          <select v-model="unitForm.rankTier">
            <option v-for="(rankLabel, index) in VISUAL_RANKS" :key="rankLabel" :value="String(index + 1)">
              Rank {{ rankLabel }}
            </option>
          </select>
        </label>
        <label>
          Картинки техники
        </label>
        <div class="image-urls-editor">
          <div v-for="(imageUrl, index) in unitForm.imageUrls" :key="`create-image-${index}`" class="image-url-row">
            <input v-model="unitForm.imageUrls[index]" type="url" :placeholder="DEFAULT_IMAGE_URL" />
            <button type="button" class="mini-button danger icon-button" @click="removeImageUrl(unitForm, index)"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg></button>
          </div>
          <button type="button" class="mini-button info" @click="addImageUrl(unitForm)"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.add" fill="currentColor"/></svg><span>картинка</span></button>
        </div>
        <button class="action-button primary" type="submit" :disabled="!unitForm.branchId">Добавить технику</button>
      </form>

      <div v-if="error" class="panel-block error-box">
        {{ error }}
      </div>
    </aside>

    <main class="workspace">
      <div v-if="loading" class="empty-state main-empty">Загрузка дерева...</div>

      <template v-else>
        <header class="workspace-header">
          <div class="workspace-head-main">
            <p class="panel-kicker">Fan Tech Tree</p>
            <div class="workspace-title-row">
              <img v-if="activeTree?.flagUrl" :src="activeTree.flagUrl" :alt="activeTree.name" class="workspace-flag" />
              <div>
                <h1>{{ activeTree?.name || 'Фан-дерево' }}</h1>
                <p class="workspace-note">Активный раздел: {{ activeVehicleCategoryLabel }}</p>
              </div>
            </div>
          </div>
          <div class="workspace-head-controls">
            <div class="header-control-group">
              <p class="workspace-control-label">Фан-деревья</p>
              <div class="header-tree-strip" :class="stripFadeClass('trees')">
                <div ref="treeStripRef" class="header-tree-switcher" @scroll="updateStripFade('trees')">
                  <button
                    v-for="fanTree in orderedTrees"
                    :key="fanTree.id"
                    class="header-tree-button"
                    :class="{ 'header-tree-button-active': fanTree.id === tree.activeTreeId }"
                    @click="switchActiveTree(fanTree.id)"
                  >
                    <img :src="fanTree.flagUrl" :alt="fanTree.name" />
                    <span>{{ fanTree.name }}</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="header-control-group header-control-group-category">
              <p class="workspace-control-label">Раздел техники</p>
              <div class="header-category-strip" :class="stripFadeClass('categories')">
                <div ref="categoryStripRef" class="header-category-switcher" @scroll="updateStripFade('categories')">
                  <button
                    v-for="option in activeTreeCategories"
                    :key="option.id"
                    class="header-category-button"
                    :class="{ 'header-category-button-active': activeVehicleCategory === option.id }"
                    @click="switchVehicleCategory(option.id)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <p v-if="addableVehicleCategories.length" class="header-inline-hint">Дополнительные разделы добавляются в сайдбаре.</p>
            </div>
          </div>
        </header>

        <section class="tree-board">
          <div v-if="boardBusy" class="board-loading-overlay" :style="{ width: boardMinWidth }">
            <div class="board-loading-block"></div>
          </div>
          <div class="board-top" :style="boardGridStyle">
            <div class="board-title board-title-research">Исследуемая техника</div>
            <div class="board-title board-title-premium">Премиум техника</div>
          </div>

          <div class="board-layout" :style="boardGridStyle">
            <section class="board-panel research-panel">
              <div v-if="!researchBranches.length" class="empty-state pretty-empty">
                <strong>Нет исследуемых линеек</strong>
                <span>Создай первую линейку для активного раздела техники.</span>
              </div>

              <template v-else>
                <div class="branch-headings" :style="researchGridStyle">
                  <div
                    v-for="branch in researchBranches"
                    :key="branch.id"
                    class="branch-heading branch-heading-droppable"
                    :class="{ 'branch-heading-drag': isDragging }"
                    @dragover="allowDrop($event, `${branch.id}-heading`)"
                    @dragleave="clearDrop(`${branch.id}-heading`)"
                    @drop="moveDraggedUnit($event, branch.id, null)"
                  >
                    <div>
                      <p class="branch-label">Line</p>
                      <strong>{{ branch.name }}</strong>
                    </div>
                    <div class="heading-actions">
                      <button class="mini-button icon-button" title="Редактировать линейку" aria-label="Редактировать линейку" @click="openBranchEditor(branch)">
                        <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.edit" fill="currentColor"/></svg>
                      </button>
                      <button class="mini-button danger icon-button" title="Удалить линейку" aria-label="Удалить линейку" @click="requestDeleteBranch(branch)">
                        <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

                <div v-for="band in rankBands" :key="`research-${band}`" class="rank-section">
                  <div class="rank-marker">Rank {{ rankLabel(band) }}</div>
                  <div class="research-row" :style="researchGridStyle">
                    <div v-for="branch in researchBranches" :key="`${branch.id}-${band}`" class="research-cell">
                      <div
                        :ref="(element) => setSortableContainer(element, sortableListKey(branch.id, band))"
                        class="sortable-list"
                        :class="{ 'sortable-list-empty': !bandUnits(branch.id, band).length }"
                        :data-branch-id="branch.id"
                        :data-rank-tier="band"
                      >
                        <div v-if="branchIsEmpty(branch.id) && band === 1" class="empty-branch-card">
                          <strong>Добавь первую технику</strong>
                          <span>Эта линейка пока пустая. Добавь карточку из сайдбара.</span>
                        </div>

                        <div v-for="unit in bandUnits(branch.id, band)" :key="unit.id" class="sortable-unit" :data-unit-id="unit.id">
                          <article class="unit-card unit-card-research" :class="{ 'unit-card-dragging': dragState.unitId === unit.id }">
                            <button class="unit-image-button" @click="openLightbox(unit)">
                              <div v-if="!imageLoaded(unit.id)" class="unit-image-skeleton"></div>
                              <img :src="primaryImage(unit)" :alt="unit.name" class="unit-image" :class="{ 'unit-image-visible': imageLoaded(unit.id) }" loading="lazy" @load="onUnitImageLoaded(unit.id)" @error="onUnitImageLoaded(unit.id)" />
                            </button>
                            <div class="unit-copy">
                              <h3>{{ unit.name }}</h3>
                              <span class="unit-rank-badge">{{ Number(unit.rank).toFixed(1) }}</span>
                            </div>
                            <div v-if="unitImages(unit).length > 1" class="unit-gallery-count">+{{ unitImages(unit).length - 1 }}</div>
                            <div class="unit-actions">
                              <button class="mini-button info icon-button" title="Информация" aria-label="Информация" @click="openInfoEditor(unit)">
                                <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.info" fill="currentColor"/></svg>
                              </button>
                              <button class="mini-button icon-button" title="Редактировать технику" aria-label="Редактировать технику" @click="openUnitEditor(unit)">
                                <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.edit" fill="currentColor"/></svg>
                              </button>
                              <button class="mini-button danger icon-button" title="Удалить технику" aria-label="Удалить технику" @click="requestDeleteUnit(unit)">
                                <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg>
                              </button>
                            </div>
                          </article>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </section>

            <section class="board-panel premium-panel">
              <div v-if="!premiumBranches.length" class="empty-state pretty-empty premium-empty">
                <strong>Пока нет особой техники</strong>
                <span>Добавь первую premium-линейку или перенеси сюда карточки.</span>
              </div>

              <template v-else>
                <div class="premium-headings" :style="premiumGridStyle">
                  <div
                    v-for="branch in premiumBranches"
                    :key="branch.id"
                    class="premium-heading branch-heading-droppable"
                    :class="{ 'branch-heading-drag': isDragging }"
                    @dragover="allowDrop($event, `${branch.id}-premium-heading`)"
                    @dragleave="clearDrop(`${branch.id}-premium-heading`)"
                    @drop="moveDraggedUnit($event, branch.id, null)"
                  >
                    <strong>{{ branch.name }}</strong>
                    <div class="heading-actions">
                      <button class="mini-button icon-button" title="Редактировать линейку" aria-label="Редактировать линейку" @click="openBranchEditor(branch)">
                        <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.edit" fill="currentColor"/></svg>
                      </button>
                      <button class="mini-button danger icon-button" title="Удалить линейку" aria-label="Удалить линейку" @click="requestDeleteBranch(branch)">
                        <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

                <div v-for="band in rankBands" :key="`premium-${band}`" class="rank-section premium-rank-section">
                  <div class="rank-marker">Rank {{ rankLabel(band) }}</div>
                  <div class="premium-row" :style="premiumGridStyle">
                    <div v-for="branch in premiumBranches" :key="`${branch.id}-${band}`" class="premium-group">
                      <div
                        :ref="(element) => setSortableContainer(element, sortableListKey(branch.id, band))"
                        class="sortable-list"
                        :class="{ 'sortable-list-empty': !bandUnits(branch.id, band).length }"
                        :data-branch-id="branch.id"
                        :data-rank-tier="band"
                      >
                        <div v-if="branchIsEmpty(branch.id) && band === 1" class="empty-branch-card premium-empty-card">
                          <strong>Добавь первую технику</strong>
                          <span>Особая линейка пока пустая.</span>
                        </div>

                        <div v-for="unit in bandUnits(branch.id, band)" :key="unit.id" class="sortable-unit" :data-unit-id="unit.id">
                          <article class="unit-card unit-card-premium" :class="{ 'unit-card-dragging': dragState.unitId === unit.id }">
                            <button class="unit-image-button" @click="openLightbox(unit)">
                              <div v-if="!imageLoaded(unit.id)" class="unit-image-skeleton"></div>
                              <img :src="primaryImage(unit)" :alt="unit.name" class="unit-image" :class="{ 'unit-image-visible': imageLoaded(unit.id) }" loading="lazy" @load="onUnitImageLoaded(unit.id)" @error="onUnitImageLoaded(unit.id)" />
                            </button>
                            <div class="unit-copy">
                              <h3>{{ unit.name }}</h3>
                              <span class="unit-rank-badge">{{ Number(unit.rank).toFixed(1) }}</span>
                            </div>
                            <div v-if="unitImages(unit).length > 1" class="unit-gallery-count">+{{ unitImages(unit).length - 1 }}</div>
                            <div class="unit-actions">
                              <button class="mini-button info icon-button" title="Информация" aria-label="Информация" @click="openInfoEditor(unit)">
                                <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.info" fill="currentColor"/></svg>
                              </button>
                              <button class="mini-button icon-button" title="Редактировать технику" aria-label="Редактировать технику" @click="openUnitEditor(unit)">
                                <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.edit" fill="currentColor"/></svg>
                              </button>
                              <button class="mini-button danger icon-button" title="Удалить технику" aria-label="Удалить технику" @click="requestDeleteUnit(unit)">
                                <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg>
                              </button>
                            </div>
                          </article>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </section>
          </div>
        </section>
      </template>
    </main>

    <div v-if="branchEditor.open" class="modal-backdrop" @click.self="closeBranchEditor">
      <div class="modal-card">
        <div class="modal-header">
          <h2>Редактировать линейку</h2>
          <button class="modal-close icon-button" @click="closeBranchEditor"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg></button>
        </div>
        <form class="modal-form" @submit.prevent="saveBranchEditor">
          <label>
            Название линейки
            <input v-model="branchEditor.name" type="text" required />
          </label>
          <label>
            Тип линейки
            <select v-model="branchEditor.type">
              <option value="research">Исследуемая</option>
              <option value="premium">Премиум / особая</option>
            </select>
          </label>
          <label>
            Раздел техники
            <select v-model="branchEditor.vehicleCategory">
              <option v-for="option in VEHICLE_CATEGORY_OPTIONS" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
          </label>
          <div class="modal-actions">
            <button type="button" class="action-button secondary" @click="closeBranchEditor"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg><span>Отмена</span></button>
            <button type="submit" class="action-button primary" :disabled="branchEditor.saving">
              <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.save" fill="currentColor"/></svg><span>{{ branchEditor.saving ? 'Сохранение...' : 'Сохранить' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="unitEditor.open" class="modal-backdrop" @click.self="closeUnitEditor">
      <div class="modal-card modal-card-wide">
        <div class="modal-header">
          <h2>Редактировать технику</h2>
          <button class="modal-close icon-button" @click="closeUnitEditor"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg></button>
        </div>
        <form class="modal-form" @submit.prevent="saveUnitEditor">
          <label>
            Линейка техники
            <select v-model="unitEditor.branchId" required>
              <option v-for="branch in orderedBranches" :key="branch.id" :value="branch.id">
                {{ branch.name }}
              </option>
            </select>
          </label>
          <label>
            Название
            <input v-model="unitEditor.name" type="text" required />
          </label>
          <label>
            Боевой ранг
            <input v-model="unitEditor.rank" type="number" min="1" max="12" step="0.1" required />
          </label>
          <label>
            Ранг
            <select v-model="unitEditor.rankTier">
              <option v-for="(rankLabel, index) in VISUAL_RANKS" :key="rankLabel" :value="String(index + 1)">
                Rank {{ rankLabel }}
              </option>
            </select>
          </label>
          <label>
            Картинки техники
          </label>
          <div class="image-urls-editor">
            <div v-for="(imageUrl, index) in unitEditor.imageUrls" :key="`edit-image-${index}`" class="image-url-row">
              <input v-model="unitEditor.imageUrls[index]" type="url" :placeholder="DEFAULT_IMAGE_URL" />
              <button type="button" class="mini-button danger icon-button" @click="removeImageUrl(unitEditor, index)"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg></button>
            </div>
            <button type="button" class="mini-button info" @click="addImageUrl(unitEditor)"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.add" fill="currentColor"/></svg><span>картинка</span></button>
          </div>
          <div class="modal-actions">
            <button type="button" class="action-button secondary" @click="closeUnitEditor"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg><span>Отмена</span></button>
            <button type="submit" class="action-button primary" :disabled="unitEditor.saving">
              <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.save" fill="currentColor"/></svg><span>{{ unitEditor.saving ? 'Сохранение...' : 'Сохранить' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="infoEditor.open" class="modal-backdrop" @click.self="closeInfoEditor">
      <div class="modal-card modal-card-wide info-modal">
        <div class="modal-header">
          <div>
            <p class="panel-kicker">Vehicle Info</p>
            <h2>{{ infoEditor.name }}</h2>
          </div>
          <button class="modal-close icon-button" @click="closeInfoEditor"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg></button>
        </div>
        <form class="modal-form" @submit.prevent="saveInfoEditor">
          <template v-if="!infoEditor.editing">
            <section class="info-view-block">
              <h3>Описание</h3>
              <p class="info-view-text">{{ infoEditor.description || 'Описание не заполнено.' }}</p>
            </section>
            <section class="info-view-block">
              <h3>Ссылки</h3>
              <div v-if="infoEditor.links.length" class="info-links-list">
                <a v-for="(link, index) in infoEditor.links" :key="`view-link-${index}`" :href="link.url" target="_blank" rel="noreferrer" class="info-link-card">{{ link.label || link.url }}</a>
              </div>
              <p v-else class="info-view-text">Ссылки не добавлены.</p>
            </section>
            <div class="modal-actions">
              <button type="button" class="action-button secondary" @click="closeInfoEditor"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg><span>Закрыть</span></button>
              <button type="button" class="action-button primary" @click="infoEditor.editing = true"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.edit" fill="currentColor"/></svg><span>Редактировать</span></button>
            </div>
          </template>
          <template v-else>
            <label>
              Описание
              <textarea v-model="infoEditor.description" rows="6" placeholder="Заметки, история, роль в ветке, почему техника должна быть добавлена..."></textarea>
            </label>

            <div class="links-editor">
              <div class="links-heading">
                <h3>Ссылки</h3>
                <button type="button" class="mini-button info" @click="addInfoLink"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.add" fill="currentColor"/></svg><span>ссылка</span></button>
              </div>
              <div v-for="(link, index) in infoEditor.links" :key="index" class="link-row">
                <input v-model="link.label" type="text" placeholder="Название ссылки" />
                <input v-model="link.url" type="url" placeholder="https://..." />
                <button type="button" class="mini-button danger icon-button" @click="removeInfoLink(index)"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg></button>
              </div>
            </div>

            <div class="modal-actions">
              <button type="button" class="action-button secondary" @click="hasInfoContent(infoEditor) ? (infoEditor.editing = false) : closeInfoEditor()"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg><span>{{ hasInfoContent(infoEditor) ? 'Назад' : 'Отмена' }}</span></button>
              <button type="submit" class="action-button primary" :disabled="infoEditor.saving">
                <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.save" fill="currentColor"/></svg><span>{{ infoEditor.saving ? 'Сохранение...' : 'Сохранить информацию' }}</span>
              </button>
            </div>
          </template>
        </form>
      </div>
    </div>

    <div v-if="confirmState.open" class="modal-backdrop" @click.self="closeConfirm">
      <div class="modal-card confirm-card">
        <div class="modal-header">
          <h2>{{ confirmState.title }}</h2>
          <button class="modal-close icon-button" @click="closeConfirm"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg></button>
        </div>
        <p class="confirm-copy">{{ confirmState.message }}</p>
        <div class="modal-actions">
          <button class="action-button secondary" :disabled="confirmState.pending" @click="closeConfirm"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg><span>Отмена</span></button>
          <button class="action-button danger-button" :disabled="confirmState.pending" @click="runConfirm">
            <svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.delete" fill="currentColor"/></svg><span>{{ confirmState.pending ? 'Удаление...' : confirmState.confirmText }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="lightboxUnit" class="lightbox-backdrop" @click.self="closeLightbox">
      <button class="lightbox-close icon-button" @click="closeLightbox"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path :d="icons.close" fill="currentColor"/></svg></button>
      <div class="lightbox-content">
        <div class="lightbox-stage">
          <button v-if="unitImages(lightboxUnit).length > 1" class="lightbox-nav lightbox-nav-prev icon-button" @click="previousLightboxImage"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path d="M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41Z" fill="currentColor"/></svg></button>
          <img :src="unitImages(lightboxUnit)[lightboxIndex]" :alt="lightboxUnit.name" class="lightbox-image" />
          <button v-if="unitImages(lightboxUnit).length > 1" class="lightbox-nav lightbox-nav-next icon-button" @click="nextLightboxImage"><svg viewBox="0 0 24 24" class="button-icon" aria-hidden="true"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41Z" fill="currentColor"/></svg></button>
        </div>
        <div v-if="unitImages(lightboxUnit).length > 1" class="lightbox-thumbs">
          <button v-for="(imageUrl, index) in unitImages(lightboxUnit)" :key="`thumb-${index}`" class="lightbox-thumb" :class="{ 'lightbox-thumb-active': index === lightboxIndex }" @click="lightboxIndex = index">
            <img :src="imageUrl" :alt="`${lightboxUnit.name} ${index + 1}`" />
          </button>
        </div>
        <div class="lightbox-caption">
          <strong>{{ lightboxUnit.name }}</strong>
          <span>BR {{ Number(lightboxUnit.rank).toFixed(1) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
