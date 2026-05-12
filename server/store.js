import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataFilePath = path.join(__dirname, 'data.json')

export const DEFAULT_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/7/7e/P68l.jpg'
export const DEFAULT_FLAG_URL = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Flag_of_the_Soviet_Union.svg'
export const DEFAULT_VEHICLE_CATEGORIES = ['ground', 'aviation']
export const ALLOWED_VEHICLE_CATEGORIES = ['ground', 'aviation', 'helicopters', 'bluewater', 'coastal']

const defaultData = {
  activeTreeId: 'tree-ussr',
  activeVehicleCategory: 'ground',
  trees: [
    { id: 'tree-ussr', name: 'Фанатская ветка СССР', flagUrl: DEFAULT_FLAG_URL, enabledCategories: DEFAULT_VEHICLE_CATEGORIES, order: 1 }
  ],
  branches: [
    { id: 'branch-medium', treeId: 'tree-ussr', vehicleCategory: 'ground', name: 'Средние танки', type: 'research', order: 1 },
    { id: 'branch-premium', treeId: 'tree-ussr', vehicleCategory: 'ground', name: 'Премиум техника', type: 'premium', order: 2 }
  ],
  units: [
    { id: 'unit-1', branchId: 'branch-medium', name: 'T-34', rank: 3.7, rankTier: 2, imageUrls: [DEFAULT_IMAGE_URL], description: '', links: [], order: 1 },
    { id: 'unit-2', branchId: 'branch-premium', name: 'T-34 Prototype', rank: 3.7, rankTier: 2, imageUrls: [DEFAULT_IMAGE_URL], description: '', links: [], order: 1 }
  ]
}

export async function ensureDataFile() {
  try {
    await fs.access(dataFilePath)
  } catch {
    await fs.writeFile(dataFilePath, JSON.stringify(defaultData, null, 2), 'utf8')
  }
}

export async function readData() {
  await ensureDataFile()
  const raw = await fs.readFile(dataFilePath, 'utf8')
  return normalizeData(JSON.parse(raw))
}

export async function writeData(data) {
  const normalized = normalizeData(data)
  await fs.writeFile(dataFilePath, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

function normalizeData(data) {
  const fallbackTreeId = data.activeTreeId || data.trees?.[0]?.id || 'tree-ussr'

  data.trees = Array.isArray(data.trees) && data.trees.length
    ? data.trees
    : [{ id: fallbackTreeId, name: data.meta?.title || 'Фанатская ветка', flagUrl: DEFAULT_FLAG_URL, order: 1 }]

  data.activeTreeId = data.trees.some((tree) => tree.id === data.activeTreeId)
    ? data.activeTreeId
    : data.trees[0].id

  data.trees = data.trees.map((tree, index) => ({
    id: tree.id,
    name: tree.name || 'Новое фан-дерево',
    flagUrl: tree.flagUrl || DEFAULT_FLAG_URL,
    enabledCategories: normalizeEnabledCategories(tree.enabledCategories),
    order: tree.order ?? index + 1
  }))

  const activeTree = data.trees.find((tree) => tree.id === data.activeTreeId) || data.trees[0]
  data.activeVehicleCategory = activeTree.enabledCategories.includes(data.activeVehicleCategory)
    ? data.activeVehicleCategory
    : activeTree.enabledCategories[0]

  data.branches = (data.branches || []).map((branch, index) => ({
    ...branch,
    treeId: branch.treeId || data.activeTreeId,
    vehicleCategory: normalizeVehicleCategory(branch.vehicleCategory),
    type: normalizeBranchType(branch.type || branch.category),
    order: branch.order ?? index + 1
  }))

  data.units = (data.units || []).map((unit, index) => {
    const imageUrls = normalizeImageUrls(unit.imageUrls, unit.imageUrl)
    const { imageUrl, ...rest } = unit
    return {
      ...rest,
      imageUrls,
      rankTier: normalizeRankTier(unit.rankTier ?? inferRankTierFromBr(unit.rank)),
      description: unit.description || '',
      links: Array.isArray(unit.links) ? unit.links : [],
      order: unit.order ?? index + 1
    }
  })

  delete data.meta
  return data
}

function normalizeVehicleCategory(category) {
  return ALLOWED_VEHICLE_CATEGORIES.includes(category) ? category : 'ground'
}

function normalizeBranchType(type) {
  return type === 'premium' ? 'premium' : 'research'
}

function normalizeEnabledCategories(categories) {
  const normalized = Array.isArray(categories)
    ? categories.map((category) => normalizeVehicleCategory(category)).filter((category, index, list) => list.indexOf(category) === index)
    : []

  return normalized.length ? normalized : [...DEFAULT_VEHICLE_CATEGORIES]
}

function normalizeRankTier(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    return 1
  }

  return Math.max(1, Math.min(8, Math.round(normalized)))
}

function inferRankTierFromBr(rank) {
  const normalized = Number(rank)
  if (!Number.isFinite(normalized)) {
    return 1
  }

  return normalizeRankTier(Math.ceil(normalized / 2))
}

function normalizeImageUrls(imageUrls, fallbackImageUrl = '') {
  const list = Array.isArray(imageUrls) ? imageUrls : []
  const normalized = [...list, fallbackImageUrl]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  const unique = Array.from(new Set(normalized))
  return unique.length ? unique : [DEFAULT_IMAGE_URL]
}
