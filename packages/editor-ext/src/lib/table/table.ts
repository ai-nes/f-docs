import { Table } from "@tiptap/extension-table";
import { Editor } from "@tiptap/core";
import { DOMOutputSpec } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { cellAround } from "@tiptap/pm/tables";

const LIST_TYPES = ["bulletList", "orderedList", "taskList"];

function isInList(editor: Editor): boolean {
  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (LIST_TYPES.includes(node.type.name)) {
      return true;
    }
  }

  return false;
}

function handleListIndent(editor: Editor): boolean {
  return (
    editor.commands.sinkListItem("listItem") ||
    editor.commands.sinkListItem("taskItem")
  );
}

function handleListOutdent(editor: Editor): boolean {
  return (
    editor.commands.liftListItem("listItem") ||
    editor.commands.liftListItem("taskItem")
  );
}

export const CustomTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // Preserve an explicit table width from imported HTML. The table node
      // view uses this to keep PDF-imported tables fluid instead of replacing
      // it with the sum of their pixel column widths.
      style: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("style"),
        renderHTML: (attributes: { style?: string | null }) =>
          attributes.style ? { style: attributes.style } : {},
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Mod-a": () => {
        const { state, view } = this.editor;
        const { selection, doc } = state;

        const $cellPos = cellAround(selection.$anchor);
        if (!$cellPos) return false;

        const cellNode = doc.nodeAt($cellPos.pos);
        // Empty cells have nothing useful to scope to — let the default
        // Mod-a fall through and select the whole doc.
        if (!cellNode || !cellNode.textContent) return false;

        const from = $cellPos.pos + 1;
        const to = $cellPos.pos + cellNode.nodeSize - 1;
        if (from >= to) return true;

        const nextSel = TextSelection.between(
          doc.resolve(from),
          doc.resolve(to),
          1,
        );
        if (!nextSel || selection.eq(nextSel)) return true;

        view.dispatch(state.tr.setSelection(nextSel));
        return true;
      },
      Tab: () => {
        // If we're in a list within a table, handle list indentation
        if (isInList(this.editor) && this.editor.isActive("table")) {
          if (handleListIndent(this.editor)) {
            return true;
          }
        }

        // Otherwise, use default table navigation
        if (this.editor.commands.goToNextCell()) {
          return true;
        }

        if (!this.editor.can().addRowAfter()) {
          return false;
        }

        return this.editor.chain().addRowAfter().goToNextCell().run();
      },
      "Shift-Tab": () => {
        // If we're in a list within a table, handle list outdentation
        if (isInList(this.editor) && this.editor.isActive("table")) {
          if (handleListOutdent(this.editor)) {
            return true;
          }
        }

        // Otherwise, use default table navigation
        return this.editor.commands.goToPreviousCell();
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    // https://github.com/ueberdosis/tiptap/issues/4872#issuecomment-2717554498
    const originalRender = this.parent?.({ node, HTMLAttributes });
    let tableRender = originalRender;

    // Tiptap generates `width: Npx` from colwidth when serializing a table.
    // That inline width wins over the editor CSS and makes imported PDF tables
    // narrower than the page in read-only/public rendering. Keep the measured
    // width as a minimum for wide tables, but let the table fill its container.
    if (
      Array.isArray(originalRender) &&
      originalRender[0] === "table" &&
      originalRender[1] &&
      typeof originalRender[1] === "object"
    ) {
      const tableAttributes = {
        ...(originalRender[1] as Record<string, unknown>),
      };
      const userStyle = String(HTMLAttributes.style || "");

      if (!/\bwidth\s*:/i.test(userStyle)) {
        const generatedStyle = String(tableAttributes.style || "");
        const minWidth =
          generatedStyle.match(/\bmin-width\s*:[^;]+/i)?.[0] ||
          generatedStyle
            .match(/\bwidth\s*:[^;]+/i)?.[0]
            .replace(/^width/i, "min-width");

        tableAttributes.style = ["width: 100%", minWidth]
          .filter(Boolean)
          .join("; ");
      }

      tableRender = [
        originalRender[0],
        tableAttributes,
        ...originalRender.slice(2),
      ] as DOMOutputSpec;
    }

    const wrapper: DOMOutputSpec = [
      "div",
      { class: "tableWrapper" },
      tableRender,
    ];
    return wrapper;
  },
});
