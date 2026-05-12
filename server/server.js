import cors from 'cors'
import express from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALLOWED_VEHICLE_CATEGORIES, DEFAULT_FLAG_URL, DEFAULT_IMAGE_URL, DEFAULT_VEHICLE_CATEGORIES, readData, writeData } from './store.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const uploadDir = path.join(rootDir, 'uploads')
const distDir = path.join(rootDir, 'dist')

await fs.mkdir(uploadDir, { recursive: true })
const app = express()

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadDir))

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeBranchType(type) {
  return type === 'premium' ? 'premium' : 'research'
}

function normalizeVehicleCategory(category) {
  return ALLOWED_VEHICLE_CATEGORIES.includes(category) ? category : 'ground'
}

function validateRank(rank) {
  const normalized = Number(rank)
  return Number.isFinite(normalized) ? normalized : null
}

function validateRankTier(rankTier, fallbackRank = null) {
  const normalized = Number(rankTier)
  if (Number.isFinite(normalized)) {
    return Math.max(1, Math.min(8, Math.round(normalized)))
  }

  if (Number.isFinite(fallbackRank)) {
    return Math.max(1, Math.min(8, Math.ceil(Number(fallbackRank) / 2)))
  }

  return 1
}

function sanitizeLinks(links) {
  if (!Array.isArray(links)) {
    return []
  }

  return links
    .map((link) => ({
      label: String(link.label || '').trim(),
      url: String(link.url || '').trim()
    }))
    .filter((link) => link.label || link.url)
}

function sanitizeImageUrls(imageUrls, fallbackImageUrl = '') {
  const list = Array.isArray(imageUrls) ? imageUrls : []
  const normalized = [...list, fallbackImageUrl]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  const unique = Array.from(new Set(normalized))
  return unique.length ? unique : [DEFAULT_IMAGE_URL]
}

function sortByOrder(items) {
  return [...items].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
}

function normalizeBranchOrder(data) {
  data.branches = sortByOrder(data.branches).map((branch, index) => ({
    ...branch,
    order: index + 1
  }))

  return data
}

function normalizeUnitOrder(data) {
  const grouped = new Map()

  for (const unit of data.units) {
    if (!grouped.has(unit.branchId)) {
      grouped.set(unit.branchId, [])
    }

    grouped.get(unit.branchId).push(unit)
  }

  data.units = Array.from(grouped.values()).flatMap((units) => {
    return sortByOrder(units).map((unit, index) => ({
      ...unit,
      order: index + 1
    }))
  })

  return data
}

function moveUnitInData(data, unitId, targetBranchId, beforeUnitId = null, targetRankTier = null) {
  const movingUnit = data.units.find((unit) => unit.id === unitId)
  const targetBranch = data.branches.find((branch) => branch.id === targetBranchId)

  if (!movingUnit || !targetBranch) {
    return false
  }

  const remainingUnits = data.units.filter((unit) => unit.id !== unitId)
  const targetUnits = sortByOrder(remainingUnits.filter((unit) => unit.branchId === targetBranchId))
  const insertIndex = beforeUnitId ? targetUnits.findIndex((unit) => unit.id === beforeUnitId) : -1
  const movedUnit = {
    ...movingUnit,
    branchId: targetBranchId,
    rankTier: validateRankTier(targetRankTier, movingUnit.rank)
  }

  if (insertIndex >= 0) {
    targetUnits.splice(insertIndex, 0, movedUnit)
  } else {
    targetUnits.push(movedUnit)
  }

  data.units = [
    ...remainingUnits.filter((unit) => unit.branchId !== targetBranchId),
    ...targetUnits
  ]

  normalizeUnitOrder(data)
  return true
}

function insertUnitByRank(data, newUnit) {
  const branchUnits = data.units.filter((unit) => unit.branchId === newUnit.branchId)
  const insertIndex = branchUnits.findIndex((unit) => Number(unit.rank) > Number(newUnit.rank))
  const nextUnits = [...branchUnits]

  if (insertIndex >= 0) {
    nextUnits.splice(insertIndex, 0, newUnit)
  } else {
    nextUnits.push(newUnit)
  }

  const otherUnits = data.units.filter((unit) => unit.branchId !== newUnit.branchId)
  data.units = [
    ...otherUnits,
    ...nextUnits.map((unit, index) => ({
      ...unit,
      order: index + 1
    }))
  ]

  return data
}

app.get('/api/tree', async (_request, response) => {
  response.json(await readData())
})

app.patch('/api/meta', async (request, response) => {
  const title = String(request.body.title || '').trim()
  if (!title) {
    response.status(400).json({ error: 'Название проекта обязательно' })
    return
  }

  const data = await readData()
  const activeTree = data.trees.find((tree) => tree.id === data.activeTreeId)
  if (activeTree) {
    activeTree.name = title
  }
  response.json(await writeData(data))
})

app.patch('/api/active', async (request, response) => {
  const data = await readData()
  const treeId = String(request.body.treeId || '').trim()
  const vehicleCategory = normalizeVehicleCategory(request.body.vehicleCategory)

  if (treeId && !data.trees.some((tree) => tree.id === treeId)) {
    response.status(404).json({ error: 'Фан-дерево не найдено' })
    return
  }

  data.activeTreeId = treeId || data.activeTreeId
  const activeTree = data.trees.find((tree) => tree.id === data.activeTreeId)
  data.activeVehicleCategory = activeTree?.enabledCategories?.includes(vehicleCategory)
    ? vehicleCategory
    : activeTree?.enabledCategories?.[0] || 'ground'
  response.json(await writeData(data))
})

app.post('/api/trees', async (request, response) => {
  const name = String(request.body.name || '').trim()
  const flagUrl = String(request.body.flagUrl || '').trim() || DEFAULT_FLAG_URL

  if (!name) {
    response.status(400).json({ error: 'Название фан-дерева обязательно' })
    return
  }

  const data = await readData()
  const tree = {
    id: createId('tree'),
    name,
    flagUrl,
    enabledCategories: [...DEFAULT_VEHICLE_CATEGORIES],
    order: data.trees.length + 1
  }

  data.trees.push(tree)
  data.activeTreeId = tree.id
  data.activeVehicleCategory = 'ground'
  response.status(201).json(await writeData(data))
})

app.patch('/api/trees/:treeId', async (request, response) => {
  const { treeId } = request.params
  const name = String(request.body.name || '').trim()
  const flagUrl = String(request.body.flagUrl || '').trim() || DEFAULT_FLAG_URL

  if (!name) {
    response.status(400).json({ error: 'Название фан-дерева обязательно' })
    return
  }

  const data = await readData()
  const treeIndex = data.trees.findIndex((tree) => tree.id === treeId)

  if (treeIndex < 0) {
    response.status(404).json({ error: 'Фан-дерево не найдено' })
    return
  }

  data.trees[treeIndex] = {
    ...data.trees[treeIndex],
    name,
    flagUrl
  }

  response.json(await writeData(data))
})

app.post('/api/trees/:treeId/categories', async (request, response) => {
  const { treeId } = request.params
  const vehicleCategory = normalizeVehicleCategory(request.body.vehicleCategory)
  const data = await readData()
  const treeIndex = data.trees.findIndex((tree) => tree.id === treeId)

  if (treeIndex < 0) {
    response.status(404).json({ error: 'Фан-дерево не найдено' })
    return
  }

  const enabledCategories = new Set(data.trees[treeIndex].enabledCategories || DEFAULT_VEHICLE_CATEGORIES)
  enabledCategories.add(vehicleCategory)
  data.trees[treeIndex].enabledCategories = Array.from(enabledCategories)
  response.status(201).json(await writeData(data))
})

app.delete('/api/trees/:treeId', async (request, response) => {
  const { treeId } = request.params
  const data = await readData()

  if (data.trees.length <= 1) {
    response.status(400).json({ error: 'Нельзя удалить последнее фан-дерево' })
    return
  }

  const removedBranchIds = data.branches.filter((branch) => branch.treeId === treeId).map((branch) => branch.id)
  data.trees = data.trees.filter((tree) => tree.id !== treeId)
  data.branches = data.branches.filter((branch) => branch.treeId !== treeId)
  data.units = data.units.filter((unit) => !removedBranchIds.includes(unit.branchId))

  if (data.activeTreeId === treeId) {
    data.activeTreeId = data.trees[0]?.id || ''
    data.activeVehicleCategory = 'ground'
  }

  response.json(await writeData(normalizeUnitOrder(normalizeBranchOrder(data))))
})

app.post('/api/branches', async (request, response) => {
  const name = String(request.body.name || '').trim()
  if (!name) {
    response.status(400).json({ error: 'Название ветки обязательно' })
    return
  }

  const data = await readData()
  const treeId = String(request.body.treeId || data.activeTreeId || '').trim()

  if (!data.trees.some((tree) => tree.id === treeId)) {
    response.status(404).json({ error: 'Фан-дерево не найдено' })
    return
  }

  data.branches.push({
    id: createId('branch'),
    treeId,
    vehicleCategory: normalizeVehicleCategory(request.body.vehicleCategory || data.activeVehicleCategory),
    name,
    type: normalizeBranchType(request.body.type || request.body.category),
    order: data.branches.length + 1
  })

  const treeIndex = data.trees.findIndex((tree) => tree.id === treeId)
  if (treeIndex >= 0 && !data.trees[treeIndex].enabledCategories.includes(data.branches.at(-1).vehicleCategory)) {
    data.trees[treeIndex].enabledCategories.push(data.branches.at(-1).vehicleCategory)
  }

  response.status(201).json(await writeData(data))
})

app.patch('/api/branches/:branchId', async (request, response) => {
  const { branchId } = request.params
  const name = String(request.body.name || '').trim()

  if (!name) {
    response.status(400).json({ error: 'Название ветки обязательно' })
    return
  }

  const data = await readData()
  const branchIndex = data.branches.findIndex((branch) => branch.id === branchId)

  if (branchIndex < 0) {
    response.status(404).json({ error: 'Ветка не найдена' })
    return
  }

  data.branches[branchIndex] = {
    ...data.branches[branchIndex],
    name,
    type: normalizeBranchType(request.body.type || request.body.category),
    vehicleCategory: normalizeVehicleCategory(request.body.vehicleCategory || data.branches[branchIndex].vehicleCategory)
  }

  const branchTree = data.trees.find((tree) => tree.id === data.branches[branchIndex].treeId)
  if (branchTree && !branchTree.enabledCategories.includes(data.branches[branchIndex].vehicleCategory)) {
    branchTree.enabledCategories.push(data.branches[branchIndex].vehicleCategory)
  }

  response.json(await writeData(normalizeBranchOrder(data)))
})

app.delete('/api/branches/:branchId', async (request, response) => {
  const { branchId } = request.params
  const data = await readData()
  data.branches = data.branches.filter((branch) => branch.id !== branchId)
  data.units = data.units.filter((unit) => unit.branchId !== branchId)
  response.json(await writeData(normalizeUnitOrder(normalizeBranchOrder(data))))
})

app.post('/api/units', async (request, response) => {
  const branchId = String(request.body.branchId || '')
  const name = String(request.body.name || '').trim()
  const rank = validateRank(request.body.rank)
  const rankTier = validateRankTier(request.body.rankTier, rank)
  const imageUrls = sanitizeImageUrls(request.body.imageUrls, request.body.imageUrl)

  if (!branchId || !name || rank === null) {
    response.status(400).json({ error: 'Ветка, название и боевой ранг обязательны' })
    return
  }

  const data = await readData()
  const branch = data.branches.find((item) => item.id === branchId)

  if (!branch) {
    response.status(404).json({ error: 'Ветка не найдена' })
    return
  }

  insertUnitByRank(data, {
    id: createId('unit'),
    branchId,
    name,
    rank,
    rankTier,
    imageUrls,
    description: '',
    links: [],
    order: 0
  })

  response.status(201).json(await writeData(data))
})

app.patch('/api/units/:unitId', async (request, response) => {
  const { unitId } = request.params
  const name = String(request.body.name || '').trim()
  const rank = validateRank(request.body.rank)
  const rankTier = validateRankTier(request.body.rankTier, rank)
  const branchId = String(request.body.branchId || '').trim()
  const imageUrls = sanitizeImageUrls(request.body.imageUrls, request.body.imageUrl)

  if (!branchId || !name || rank === null) {
    response.status(400).json({ error: 'Ветка, название и боевой ранг обязательны' })
    return
  }

  const data = await readData()
  const unitIndex = data.units.findIndex((unit) => unit.id === unitId)
  const targetBranch = data.branches.find((branch) => branch.id === branchId)

  if (unitIndex < 0) {
    response.status(404).json({ error: 'Техника не найдена' })
    return
  }

  if (!targetBranch) {
    response.status(404).json({ error: 'Ветка не найдена' })
    return
  }

  const previousBranchId = data.units[unitIndex].branchId
  data.units[unitIndex] = {
    ...data.units[unitIndex],
    branchId,
    name,
    rank,
    rankTier,
    imageUrls
  }

  if (previousBranchId !== branchId) {
    moveUnitInData(data, unitId, branchId, null, rankTier)
  }

  response.json(await writeData(normalizeUnitOrder(data)))
})

app.patch('/api/units/:unitId/move', async (request, response) => {
  const { unitId } = request.params
  const targetBranchId = String(request.body.targetBranchId || '').trim()
  const beforeUnitId = String(request.body.beforeUnitId || '').trim() || null
  const targetRankTier = validateRankTier(request.body.targetRankTier)

  if (!targetBranchId) {
    response.status(400).json({ error: 'Целевая ветка обязательна' })
    return
  }

  const data = await readData()
  const moved = moveUnitInData(data, unitId, targetBranchId, beforeUnitId, targetRankTier)

  if (!moved) {
    response.status(404).json({ error: 'Не удалось перенести технику' })
    return
  }

  response.json(await writeData(data))
})

app.patch('/api/units/:unitId/info', async (request, response) => {
  const { unitId } = request.params
  const data = await readData()
  const unitIndex = data.units.findIndex((unit) => unit.id === unitId)

  if (unitIndex < 0) {
    response.status(404).json({ error: 'Техника не найдена' })
    return
  }

  data.units[unitIndex] = {
    ...data.units[unitIndex],
    description: String(request.body.description || '').trim(),
    links: sanitizeLinks(request.body.links)
  }

  response.json(await writeData(data))
})

app.delete('/api/units/:unitId', async (request, response) => {
  const { unitId } = request.params
  const data = await readData()
  data.units = data.units.filter((unit) => unit.id !== unitId)
  response.json(await writeData(normalizeUnitOrder(data)))
})

if (await exists(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api')) {
      next()
      return
    }

    response.sendFile(path.join(distDir, 'index.html'))
  })
}

const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}
