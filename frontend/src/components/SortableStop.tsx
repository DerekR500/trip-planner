import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { Stop } from '../../../shared/protocol'

type Props = {
  stop: Stop
  position: number
  onRename: (stopId: string, current: string) => void
  onDelete: (stopId: string) => void
}

/**
 * One draggable row.
 *
 * The drag listeners live on a dedicated handle rather than the whole row, so the Rename
 * and Delete buttons stay clickable. The handle is a real <button>, which is what gives
 * keyboard dragging for free: Tab to it, Space to pick up, arrows to move, Space to drop.
 */
export default function SortableStop({ stop, position, onRename, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Lift the row being dragged so it reads as "in hand".
        opacity: isDragging ? 0.4 : 1,
        listStyle: 'none',
        padding: '2px 0',
      }}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${stop.name}. Press space, then use the arrow keys.`}
        style={{ cursor: 'grab', marginRight: 6 }}
      >
        ⠿
      </button>
      {position}. {stop.name}
      {stop.address && <span> — {stop.address}</span>}{' '}
      <button onClick={() => onRename(stop.id, stop.name)}>Rename</button>
      <button onClick={() => onDelete(stop.id)}>Delete</button>
    </li>
  )
}
