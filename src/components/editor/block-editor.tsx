"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { BLOCK_TYPES, type Block, type BlockType } from "@/lib/content/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { createEmptyBlock, BLOCK_LABELS } from "@/components/editor/block-defaults";
import { BlockEditorCard } from "@/components/editor/block-editor-card";
import { validateBlocksForPublish, hasBlockingIssues } from "@/components/editor/validation";

/**
 * The SOP / lesson block editor. Blocks are lifted state — this component
 * only ever calls `onChange` with a new array, never mutates in place.
 *
 * Reordering has two paths: the up/down buttons (keyboard accessible, always
 * present) are the primary mechanism; HTML5 drag-and-drop on the card is an
 * enhancement layered on top for pointer users.
 */
export function BlockEditor({ blocks, onChange }: { blocks: Block[]; onChange: (blocks: Block[]) => void }) {
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const issues = validateBlocksForPublish(blocks);
  const blockCount = blocks.length;

  function updateBlock(index: number, next: Block) {
    if (index < 0 || index >= blocks.length) return;
    const copy = blocks.slice();
    copy[index] = next;
    onChange(copy);
  }

  function addBlock(type: BlockType) {
    onChange([...blocks, createEmptyBlock(type)]);
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const a = blocks[index];
    const b = blocks[target];
    if (!a || !b) return;
    const copy = blocks.slice();
    copy[index] = b;
    copy[target] = a;
    onChange(copy);
  }

  function duplicateBlock(index: number) {
    const source = blocks[index];
    if (!source) return;
    const clone: Block = { ...(structuredClone(source) as Block), id: `${source.id}-copy-${Date.now()}` };
    const copy = blocks.slice();
    copy.splice(index + 1, 0, clone);
    onChange(copy);
  }

  function deleteBlock(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
    setConfirmDeleteIndex(null);
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const copy = blocks.slice();
    const [moved] = copy.splice(from, 1);
    if (!moved) return;
    copy.splice(to, 0, moved);
    onChange(copy);
  }

  const blockPendingDelete = confirmDeleteIndex !== null ? blocks[confirmDeleteIndex] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {issues.length > 0 && (
        <div
          role={hasBlockingIssues(issues) ? "alert" : "status"}
          className="rounded-md border border-warning-100 bg-warning-50 px-4 py-3 text-[0.8125rem] text-warning-700"
        >
          <p className="font-semibold">
            {hasBlockingIssues(issues) ? "Fix these before publishing:" : "Worth a look before publishing:"}
          </p>
          <ul className="mt-1.5 list-disc pl-5">
            {issues.map((issue, i) => (
              <li key={i}>
                Block {issue.index + 1} ({BLOCK_LABELS[blocks[issue.index]?.type ?? "paragraph"]}): {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blockCount === 0 ? (
        <EmptyState
          icon={<Icon name="content" className="h-5 w-5" />}
          title="No content yet"
          description="Start building the SOP body by adding your first block."
          actions={<AddBlockMenu onSelect={addBlock} triggerLabel="Add your first block" />}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((block, index) => (
            <div
              key={block.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIndex(index);
              }}
              onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) reorder(dragIndex, index);
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              className={dragOverIndex === index && dragIndex !== null && dragIndex !== index ? "rounded-lg ring-2 ring-[var(--focus-ring)]" : undefined}
            >
              <BlockEditorCard
                block={block}
                index={index}
                total={blockCount}
                issues={issues.filter((issue) => issue.blockId === block.id)}
                onChange={(next) => updateBlock(index, next)}
                onMoveUp={() => moveBlock(index, -1)}
                onMoveDown={() => moveBlock(index, 1)}
                onDuplicate={() => duplicateBlock(index)}
                onDeleteRequest={() => setConfirmDeleteIndex(index)}
              />
            </div>
          ))}
        </div>
      )}

      {blockCount > 0 && <AddBlockMenu onSelect={addBlock} triggerLabel="Add block" />}

      <Dialog.Root open={confirmDeleteIndex !== null} onOpenChange={(open) => !open && setConfirmDeleteIndex(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-lg focus:outline-none">
            <Dialog.Title className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Delete this block?</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">
              {blockPendingDelete
                ? `This removes the "${BLOCK_LABELS[blockPendingDelete.type]}" block. This can't be undone once you save the draft.`
                : "This can't be undone once you save the draft."}
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button variant="danger" onClick={() => confirmDeleteIndex !== null && deleteBlock(confirmDeleteIndex)}>
                Delete block
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function AddBlockMenu({ onSelect, triggerLabel }: { onSelect: (type: BlockType) => void; triggerLabel: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" className="self-start">
          <Glyph name="plus" className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-80 w-64 overflow-y-auto rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-1 shadow-md"
        >
          {BLOCK_TYPES.map((type) => (
            <DropdownMenu.Item
              key={type}
              onSelect={() => onSelect(type)}
              className="cursor-pointer select-none rounded-md px-2.5 py-2 text-[0.8125rem] text-[var(--text-primary)] outline-none data-[highlighted]:bg-[var(--surface-sunken)]"
            >
              {BLOCK_LABELS[type]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
