const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const USER_ID = 'yourname_ddmmyyyy';
const EMAIL_ID = 'your_email';
const COLLEGE_ROLL_NUMBER = 'your_roll';

const EDGE_PATTERN = /^[A-Z]->[A-Z]$/;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

function normalizeEntry(entry) {
  if (typeof entry !== 'string') {
    return String(entry ?? '');
  }

  return entry.trim();
}

function isValidEdge(entry) {
  return EDGE_PATTERN.test(entry) && entry[0] !== entry[3];
}

function addToSetMap(map, key, value) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }

  map.get(key).add(value);
}

function buildUndirectedGraph(nodes, directedGraph) {
  const undirected = new Map();

  for (const node of nodes) {
    undirected.set(node, new Set());
  }

  for (const [parent, children] of directedGraph.entries()) {
    for (const child of children) {
      addToSetMap(undirected, parent, child);
      addToSetMap(undirected, child, parent);
    }
  }

  return undirected;
}

function getConnectedComponents(nodes, undirectedGraph) {
  const visited = new Set();
  const components = [];

  const sortedNodes = [...nodes].sort();

  for (const startNode of sortedNodes) {
    if (visited.has(startNode)) {
      continue;
    }

    const stack = [startNode];
    const component = new Set();
    visited.add(startNode);

    while (stack.length > 0) {
      const node = stack.pop();
      component.add(node);

      const neighbours = undirectedGraph.get(node) || new Set();
      for (const neighbour of neighbours) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          stack.push(neighbour);
        }
      }
    }

    components.push(component);
  }

  return components;
}

function hasCycleInComponent(component, directedGraph) {
  const color = new Map();

  for (const node of component) {
    color.set(node, 0);
  }

  const visit = (node) => {
    color.set(node, 1);

    const children = directedGraph.get(node) || new Set();
    for (const child of children) {
      if (!component.has(child)) {
        continue;
      }

      const state = color.get(child) || 0;
      if (state === 1) {
        return true;
      }

      if (state === 0 && visit(child)) {
        return true;
      }
    }

    color.set(node, 2);
    return false;
  };

  for (const node of [...component].sort()) {
    if ((color.get(node) || 0) === 0 && visit(node)) {
      return true;
    }
  }

  return false;
}

function buildNestedTree(root, directedGraph, pathStack = new Set()) {
  if (pathStack.has(root)) {
    return {};
  }

  pathStack.add(root);
  const branch = {};
  const children = [...(directedGraph.get(root) || new Set())].sort();

  for (const child of children) {
    branch[child] = buildNestedTree(child, directedGraph, pathStack);
  }

  pathStack.delete(root);
  return branch;
}

function calculateDepth(root, directedGraph, memo = new Map()) {
  if (memo.has(root)) {
    return memo.get(root);
  }

  const children = directedGraph.get(root) || new Set();
  if (children.size === 0) {
    memo.set(root, 1);
    return 1;
  }

  let maxDepth = 0;
  for (const child of children) {
    maxDepth = Math.max(maxDepth, calculateDepth(child, directedGraph, memo));
  }

  const depth = maxDepth + 1;
  memo.set(root, depth);
  return depth;
}

function processHierarchyData(rawData) {
  const invalidEntries = [];
  const duplicateEdges = [];
  const seenEdges = new Set();
  const directedGraph = new Map();
  const indegree = new Map();
  const nodes = new Set();

  for (const rawEntry of rawData) {
    const entry = normalizeEntry(rawEntry);

    if (!isValidEdge(entry)) {
      invalidEntries.push(entry);
      continue;
    }

    if (seenEdges.has(entry)) {
      if (!duplicateEdges.includes(entry)) {
        duplicateEdges.push(entry);
      }
      continue;
    }

    seenEdges.add(entry);

    const parent = entry[0];
    const child = entry[3];

    nodes.add(parent);
    nodes.add(child);

    addToSetMap(directedGraph, parent, child);

    if (!indegree.has(parent)) {
      indegree.set(parent, 0);
    }

    indegree.set(child, (indegree.get(child) || 0) + 1);
  }

  const undirectedGraph = buildUndirectedGraph(nodes, directedGraph);
  const components = getConnectedComponents(nodes, undirectedGraph);
  const hierarchies = [];
  let totalTrees = 0;
  let totalCycles = 0;
  let largestTreeRoot = '';
  let largestTreeDepth = 0;

  for (const component of components) {
    const sortedComponentNodes = [...component].sort();
    const cyclic = hasCycleInComponent(component, directedGraph);

    if (cyclic) {
      totalCycles += 1;
      hierarchies.push({
        root: sortedComponentNodes[0],
        tree: {},
        has_cycle: true
      });
      continue;
    }

    const roots = sortedComponentNodes.filter((node) => (indegree.get(node) || 0) === 0);

    for (const root of roots) {
      const tree = { [root]: buildNestedTree(root, directedGraph) };
      const depth = calculateDepth(root, directedGraph);

      hierarchies.push({
        root,
        tree,
        depth
      });

      totalTrees += 1;

      if (depth > largestTreeDepth || (depth === largestTreeDepth && (largestTreeRoot === '' || root < largestTreeRoot))) {
        largestTreeDepth = depth;
        largestTreeRoot = root;
      }
    }
  }

  hierarchies.sort((left, right) => left.root.localeCompare(right.root));

  return {
    user_id: USER_ID,
    email_id: EMAIL_ID,
    college_roll_number: COLLEGE_ROLL_NUMBER,
    hierarchies,
    invalid_entries: invalidEntries,
    duplicate_edges: duplicateEdges,
    summary: {
      total_trees: totalTrees,
      total_cycles: totalCycles,
      largest_tree_root: largestTreeRoot
    }
  };
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.post('/bfhl', (req, res) => {
  if (!req.body || !Array.isArray(req.body.data)) {
    return res.status(400).json({
      error: 'Request body must include a data array.'
    });
  }

  const response = processHierarchyData(req.body.data);
  return res.json(response);
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found.'
  });
});

app.listen(PORT, () => {
  console.log(`BFHL Hierarchy Processor running on http://localhost:${PORT}`);
});