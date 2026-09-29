const TAGS = Object.freeze({ center: 'div', table: 'div', row: 'div', cell: 'div' });
const INTERPOLATION = /{{\s*([a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)*)\s*}}/g;

export const DEFAULT_TEMPLATE = `<center>Plan 用量</center>
<table>
  <row><cell>5h</cell><cell>{{fiveHour.used}}</cell><cell>{{fiveHour.reset}}</cell></row>
  <row><cell>1w</cell><cell>{{weekly.used}}</cell><cell>{{weekly.reset}}</cell></row>
</table>`;

export function parseTemplate(source) {
  if (typeof source !== 'string') throw new TypeError('Template must be a string');
  const root = { tag: 'root', children: [] };
  const stack = [root];
  const tokens = source.match(/<[^>]*>|[^<]+/g) || [];
  if (tokens.join('') !== source) throw new Error('Invalid template syntax');
  for (const token of tokens) {
    if (token.startsWith('<')) {
      const match = /^<(\/)?(center|table|row|cell)>$/.exec(token);
      if (!match) throw new Error(`Unsupported template tag: ${token}`);
      const [, closing, tag] = match;
      if (closing) {
        if (stack.length === 1 || stack.at(-1).tag !== tag) throw new Error(`Unmatched closing tag: ${tag}`);
        stack.pop();
      } else {
        const node = { tag, children: [] };
        stack.at(-1).children.push(node);
        stack.push(node);
      }
    } else {
      stack.at(-1).children.push({ text: token });
    }
  }
  if (stack.length !== 1) throw new Error(`Unclosed template tag: ${stack.at(-1).tag}`);
  return root;
}

function valueAt(data, path) {
  let value = data;
  for (const part of path.split('.')) value = value?.[part];
  return value == null ? '—' : String(value);
}

export function renderTemplate(tree, data, documentRef = document) {
  const fragment = documentRef.createDocumentFragment();
  const append = (node, parent) => {
    if ('text' in node) {
      parent.appendChild(documentRef.createTextNode(node.text.replace(INTERPOLATION, (_, path) => valueAt(data, path))));
      return;
    }
    const element = documentRef.createElement(TAGS[node.tag]);
    element.className = `dsh-${node.tag}`;
    for (const child of node.children) append(child, element);
    parent.appendChild(element);
  };
  for (const child of tree.children) append(child, fragment);
  return fragment;
}
