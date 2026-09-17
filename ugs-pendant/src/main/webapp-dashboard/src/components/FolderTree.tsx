import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight, faFolder, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import "./FolderTree.scss";

// Deliberately loose - OpenFileModal's TreeNode (folders + files) satisfies
// this without either file needing to import a type from the other.
export type FolderTreeNode = {
  folders: Map<string, FolderTreeNode>;
};

type Props = {
  root: FolderTreeNode;
  currentPath: string[];
  expandedPaths: Set<string>;
  // Total file count (this folder plus everything under it) keyed by
  // "/"-joined path - lets you tell a folder's worth opening before tapping
  // into it, without OpenFileModal handing this component its own file
  // arrays just to recount them.
  fileCounts: Map<string, number>;
  onSelect: (path: string[]) => void;
  onToggle: (path: string[]) => void;
};

const keyOf = (path: string[]) => path.join("/");

// Recursive by nature (a folder can contain folders), so this renders itself
// via a plain function rather than a second React component - keeps
// depth/indentation as a simple parameter instead of tree-shaped context.
const renderChildren = (
  node: FolderTreeNode,
  path: string[],
  depth: number,
  currentPath: string[],
  expandedPaths: Set<string>,
  fileCounts: Map<string, number>,
  onSelect: (path: string[]) => void,
  onToggle: (path: string[]) => void
) => {
  const names = [...node.folders.keys()].sort((a, b) =>
    a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase())
  );

  return names.map((name) => {
    const childPath = [...path, name];
    const child = node.folders.get(name)!;
    const hasChildren = child.folders.size > 0;
    const isExpanded = expandedPaths.has(keyOf(childPath));
    const isActive = keyOf(childPath) === keyOf(currentPath);

    return (
      <div key={keyOf(childPath)}>
        <div
          className={`folderTreeRow${isActive ? " active" : ""}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => onSelect(childPath)}
        >
          <button
            type="button"
            className="folderTreeToggle"
            // A leaf folder still gets the same left padding as its siblings
            // that do have an arrow - just with nothing drawn in it - so
            // every row's name lines up in a straight column regardless of
            // depth or whether that particular folder happens to branch.
            style={{ visibility: hasChildren ? "visible" : "hidden" }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(childPath);
            }}
          >
            <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} />
          </button>
          <FontAwesomeIcon icon={isActive ? faFolderOpen : faFolder} className="folderTreeIcon" />
          <span className="folderTreeName">{name}</span>
          <span className="folderTreeCount">{fileCounts.get(keyOf(childPath)) ?? 0}</span>
        </div>
        {hasChildren && isExpanded &&
          renderChildren(child, childPath, depth + 1, currentPath, expandedPaths, fileCounts, onSelect, onToggle)}
      </div>
    );
  });
};

const FolderTree = ({ root, currentPath, expandedPaths, fileCounts, onSelect, onToggle }: Props) => (
  <div className="folderTree">
    {renderChildren(root, [], 0, currentPath, expandedPaths, fileCounts, onSelect, onToggle)}
  </div>
);

export default FolderTree;
