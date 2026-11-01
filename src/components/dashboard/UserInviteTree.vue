<template>
  <section class="dash-panel-section">
    <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <div>
        <div class="font-mono text-xs text-muted">
          total lineage: <span class="text-primary">{{ totalSouls }}</span> souls
        </div>
        <p class="text-xs text-dash-muted">account-scoped invitation lineage.</p>
      </div>
      <div class="flex items-center gap-2">
        <q-input
          v-model="searchQuery"
          dense
          outlined
          placeholder="search user..."
          input-class="text-dash-text"
          class="w-40"
          @keyup.enter="highlightSearch"
          clearable
          @clear="clearSearch"
        >
          <template #prepend>
            <q-icon name="mdi-magnify" size="xs" class="text-dash-muted" />
          </template>
        </q-input>
        <q-btn
          unelevated
          class="bg-dash-card text-dash-text border border-solid border-dash-border"
          icon="mdi-refresh"
          label="refresh"
          :loading="lineageLoading"
          @click="fetchLineage"
        />
      </div>
    </div>

    <div v-if="lineageLoading" class="text-dash-muted text-sm">tracing lineage...</div>

    <div v-else-if="nodesRaw.length === 0" class="text-dash-muted text-sm py-8 text-center">
      your lineage has not yet begun. share a code to plant the first seed.
    </div>

    <div
      v-else
      ref="containerRef"
      class="relative w-full border border-solid border-dash-border bg-[#050505] overflow-auto"
      style="height: 520px; max-height: 70vh; user-select: none"
      @mousedown="onPanStart"
      @mousemove="onPanMove"
      @mouseup="onPanEnd"
      @mouseleave="onPanEnd"
      @wheel.prevent="onWheel"
      :style="{ cursor: isPanning ? 'grabbing' : 'grab' }"
    >
      <svg width="100%" height="100%" class="block" :viewBox="`0 0 ${svgWidth} ${svgHeight}`">
        <defs>
          <filter
            id="edge-glow-user"
            filterUnits="userSpaceOnUse"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0" />
          </filter>
        </defs>
        <g :transform="transformString">
          <g class="tree-edges">
            <path
              v-for="edge in treeEdges"
              :key="`${edge.from}-${edge.to}`"
              :d="edge.path"
              fill="none"
              shape-rendering="crispEdges"
              vector-effect="non-scaling-stroke"
              stroke-linecap="square"
              stroke-linejoin="miter"
              :stroke="edge.highlighted ? 'var(--primary)' : '#333'"
              :stroke-width="edge.highlighted ? 3 : 1.5"
              :opacity="edge.highlighted ? 1 : 0.85"
              filter="url(#edge-glow-user)"
            />
          </g>
          <g class="tree-nodes">
            <g
              v-for="node in treeNodes"
              :key="node.id"
              :transform="`translate(${node.x}, ${node.y})`"
              class="tree-node cursor-pointer"
              @mouseenter="hoveredNode = node"
              @mouseleave="hoveredNode = null"
            >
              <circle
                r="5"
                :fill="nodeColor(node)"
                :stroke="node.highlighted ? 'var(--primary)' : 'none'"
                :stroke-width="node.highlighted ? 2 : 0"
              />
              <text
                y="-10"
                text-anchor="middle"
                :fill="node.highlighted ? 'var(--primary)' : '#555'"
                font-size="9"
                font-family="monospace"
              >
                {{ node.username }}
              </text>
              <text
                v-if="node.childCount > 0"
                y="16"
                text-anchor="middle"
                fill="#333"
                font-size="8"
                font-family="monospace"
              >
                {{ node.childCount }}
              </text>
            </g>
          </g>
        </g>
      </svg>

      <div class="absolute bottom-3 right-3 z-20 flex flex-col gap-2 items-end">
        <div
          class="flex flex-col gap-2 bg-dash-card border border-dash-border rounded-lg p-2 shadow-lg"
        >
          <q-btn
            dense
            icon="mdi-magnify-plus-outline"
            @click="zoomIn"
            size="sm"
            flat
            color="primary"
          />
          <q-btn
            dense
            icon="mdi-magnify-minus-outline"
            @click="zoomOut"
            size="sm"
            flat
            color="primary"
          />
          <q-btn dense icon="mdi-target" @click="resetTransform" size="sm" flat color="primary" />
        </div>
      </div>

      <div
        v-if="hoveredNode"
        class="absolute pointer-events-none bg-dash-card border border-solid border-dash-border text-dash-text text-xs px-3 py-2 font-mono z-10"
        :style="{ left: hoveredNode.x + 16 + 'px', top: hoveredNode.y - 10 + 'px' }"
      >
        <div class="text-primary font-semibold">{{ hoveredNode.username }}</div>
        <div class="text-dash-muted mt-1">{{ hoveredNode.isBanned ? 'exiled' : 'active' }}</div>
        <div class="text-dash-muted">joined {{ formatDate(hoveredNode.createdAt) }}</div>
        <div class="text-dash-muted">
          {{ hoveredNode.childCount }} invite{{ hoveredNode.childCount === 1 ? '' : 's' }}
        </div>
        <div v-if="hoveredNode.depth === 0" class="text-primary mt-1">root</div>
      </div>
    </div>

    <div class="flex items-center gap-4 mt-3 text-[10px] text-dash-muted font-mono">
      <div class="flex items-center gap-1">
        <span class="inline-block w-2 h-2 rounded-full bg-[#eeeeee]"></span>
        <span>active</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="inline-block w-2 h-2 rounded-full bg-primary"></span>
        <span>exiled</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="inline-block w-2 h-2 rounded-full bg-[#66bb6a]"></span>
        <span>root (no inviter)</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from 'boot/axios';

const containerRef = ref<HTMLDivElement | null>(null);
const lineageLoading = ref(false);
const searchQuery = ref('');

const transform = ref({ x: 0, y: 0, scale: 1 });
const isPanning = ref(false);
let lastPan = { x: 0, y: 0 };
let panRAF: number | null = null;

const minZoom = 0.2;
const maxZoom = 3;

const transformString = computed(
  () => `translate(${transform.value.x},${transform.value.y}) scale(${transform.value.scale})`,
);

type RawNode = {
  id: string;
  username: string;
  createdAt: string;
  isBanned: boolean;
};

type RawEdge = {
  from: string;
  to: string;
};

type TreeNodeData = {
  id: string;
  username: string;
  isBanned: boolean;
  createdAt: string;
  depth: number;
  childCount: number;
  x: number;
  y: number;
  highlighted: boolean;
};

type TreeEdgeData = {
  from: string;
  to: string;
  path: string;
  highlighted: boolean;
};

interface HierNode {
  id: string;
  username: string;
  isBanned: boolean;
  createdAt: string;
  children: HierNode[];
  x: number;
  y: number;
  depth: number;
  subtreeWidth: number;
}

const nodesRaw = ref<RawNode[]>([]);
const edgesRaw = ref<RawEdge[]>([]);
const hoveredNode = ref<TreeNodeData | null>(null);

const totalSouls = computed(() => nodesRaw.value.length);

function onPanStart(e: MouseEvent) {
  if (e.button !== 0) return;
  isPanning.value = true;
  lastPan = { x: e.clientX, y: e.clientY };
}

function onPanMove(e: MouseEvent) {
  if (!isPanning.value) return;
  if (panRAF) return;
  panRAF = requestAnimationFrame(() => {
    const dx = e.clientX - lastPan.x;
    const dy = e.clientY - lastPan.y;
    transform.value.x += dx;
    transform.value.y += dy;
    lastPan = { x: e.clientX, y: e.clientY };
    panRAF = null;
  });
}

function onPanEnd() {
  isPanning.value = false;
}

function onWheel(e: WheelEvent) {
  const { offsetX, offsetY, deltaY } = e;
  const svgRect = (
    containerRef.value?.querySelector('svg') as SVGSVGElement
  )?.getBoundingClientRect();
  if (!svgRect) return;

  const scaleAmount = deltaY < 0 ? 1.1 : 0.9;
  let newScale = transform.value.scale * scaleAmount;
  newScale = Math.max(minZoom, Math.min(maxZoom, newScale));

  const wx = (offsetX - transform.value.x) / transform.value.scale;
  const wy = (offsetY - transform.value.y) / transform.value.scale;
  transform.value.x = offsetX - wx * newScale;
  transform.value.y = offsetY - wy * newScale;
  transform.value.scale = newScale;
}

function zoomIn() {
  setZoom(transform.value.scale * 1.2);
}

function zoomOut() {
  setZoom(transform.value.scale * 0.8);
}

function setZoom(newScale: number) {
  newScale = Math.max(minZoom, Math.min(maxZoom, newScale));
  const container = containerRef.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const wx = (cx - transform.value.x) / transform.value.scale;
  const wy = (cy - transform.value.y) / transform.value.scale;
  transform.value.x = cx - wx * newScale;
  transform.value.y = cy - wy * newScale;
  transform.value.scale = newScale;
}

function resetTransform() {
  transform.value = { x: 0, y: 0, scale: 1 };
}

function buildHierarchy(nodes: RawNode[], edges: RawEdge[]): HierNode[] {
  const nodeMap = new Map<string, HierNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      username: n.username,
      isBanned: n.isBanned,
      createdAt: n.createdAt,
      children: [],
      x: 0,
      y: 0,
      depth: 0,
      subtreeWidth: 0,
    });
  }

  const hasParent = new Set<string>();
  for (const edge of edges) {
    const parent = nodeMap.get(edge.from);
    const child = nodeMap.get(edge.to);
    if (parent && child) {
      parent.children.push(child);
      hasParent.add(child.id);
    }
  }

  const roots: HierNode[] = [];
  for (const node of nodeMap.values()) {
    if (!hasParent.has(node.id)) roots.push(node);
  }

  function getSubtreeSize(node: HierNode): number {
    return 1 + node.children.reduce((acc, child) => acc + getSubtreeSize(child), 0);
  }

  roots.sort((a, b) => getSubtreeSize(b) - getSubtreeSize(a));
  return roots;
}

function calculateSubtreeWidths(node: HierNode, spacingX: number): number {
  if (node.children.length === 0) {
    node.subtreeWidth = spacingX;
    return spacingX;
  }

  let totalWidth = 0;
  for (const child of node.children) {
    totalWidth += calculateSubtreeWidths(child, spacingX);
  }
  node.subtreeWidth = totalWidth;
  return totalWidth;
}

function positionNodes(node: HierNode, startX: number, currentDepth: number, spacingY: number) {
  node.depth = currentDepth;
  node.y = currentDepth * spacingY;
  node.x = startX + node.subtreeWidth / 2;

  let childXPointer = startX;
  for (const child of node.children) {
    positionNodes(child, childXPointer, currentDepth + 1, spacingY);
    childXPointer += child.subtreeWidth;
  }
}

const NODE_SPACING_X = 100;
const LEVEL_SPACING_Y = 100;
const PADDING = 80;

const treeData = computed(() => {
  if (nodesRaw.value.length === 0)
    return { nodes: [] as TreeNodeData[], edges: [] as TreeEdgeData[] };

  const roots = buildHierarchy(nodesRaw.value, edgesRaw.value);
  for (const root of roots) {
    calculateSubtreeWidths(root, NODE_SPACING_X);
  }

  let currentXOffset = 0;
  for (const root of roots) {
    positionNodes(root, currentXOffset, 0, LEVEL_SPACING_Y);
    currentXOffset += root.subtreeWidth + NODE_SPACING_X * 0.5;
  }

  const nodes: TreeNodeData[] = [];
  const edges: TreeEdgeData[] = [];

  function flatten(node: HierNode) {
    nodes.push({
      id: node.id,
      username: node.username,
      isBanned: node.isBanned,
      createdAt: node.createdAt,
      depth: node.depth,
      childCount: node.children.length,
      x: node.x + PADDING,
      y: node.y + PADDING,
      highlighted: false,
    });

    for (const child of node.children) {
      const px = node.x + PADDING;
      const py = node.y + PADDING;
      const cx = child.x + PADDING;
      const cy = child.y + PADDING;
      const midY = (py + cy) / 2;

      edges.push({
        from: node.id,
        to: child.id,
        path: `M ${px} ${py + 5} V ${midY} H ${cx} V ${cy - 5}`,
        highlighted: false,
      });
      flatten(child);
    }
  }

  for (const root of roots) {
    flatten(root);
  }

  return { nodes, edges };
});

const treeNodes = computed(() => {
  const data = treeData.value.nodes;
  if (!searchQuery.value) return data;
  const query = searchQuery.value.toLowerCase();
  return data.map((node) => ({
    ...node,
    highlighted: node.username.toLowerCase().includes(query),
  }));
});

const treeEdges = computed(() => {
  const data = treeData.value.edges;
  if (!searchQuery.value) return data;
  const highlightedIds = new Set(treeNodes.value.filter((n) => n.highlighted).map((n) => n.id));
  return data.map((edge) => ({
    ...edge,
    highlighted: highlightedIds.has(edge.from) || highlightedIds.has(edge.to),
  }));
});

const svgWidth = computed(() => {
  if (treeData.value.nodes.length === 0) return 800;
  const maxX = Math.max(...treeData.value.nodes.map((n) => n.x));
  return maxX + PADDING * 2;
});

const svgHeight = computed(() => {
  if (treeData.value.nodes.length === 0) return 520;
  const maxY = Math.max(...treeData.value.nodes.map((n) => n.y));
  return Math.max(520, maxY + PADDING * 2);
});

function nodeColor(node: TreeNodeData): string {
  if (node.isBanned) return 'var(--primary)';
  if (node.depth === 0) return '#66bb6a';
  return '#eeeeee';
}

function highlightSearch() {
  const match = treeNodes.value.find((n) => n.highlighted);
  if (match && containerRef.value) {
    containerRef.value.scrollTo({
      left: Math.max(0, match.x - 200),
      top: Math.max(0, match.y - 200),
      behavior: 'smooth',
    });
  }
}

function clearSearch() {
  searchQuery.value = '';
}

const formatDate = (val: string | Date) => new Date(val).toLocaleDateString();

async function fetchLineage() {
  lineageLoading.value = true;
  try {
    const res = await api.get('/api/v1/profile/my-lineage');
    if (res.data?.success) {
      nodesRaw.value = Array.isArray(res.data.data?.nodes) ? res.data.data.nodes : [];
      edgesRaw.value = Array.isArray(res.data.data?.edges) ? res.data.data.edges : [];
    } else {
      nodesRaw.value = [];
      edgesRaw.value = [];
    }
  } catch (error) {
    console.error('[UserInviteTree.fetchLineage] request failed', error);
    if (import.meta.env.DEV) console.error('Failed to fetch personal invite lineage', error);
    nodesRaw.value = [];
    edgesRaw.value = [];
  } finally {
    lineageLoading.value = false;
  }
}

onMounted(async () => {
  await fetchLineage();
});
</script>

<style scoped>
.tree-node {
  transition: opacity 0.2s;
}

.tree-node:hover circle {
  filter: drop-shadow(0 0 4px currentColor);
}

.tree-node:hover text {
  fill: var(--primary) !important;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
