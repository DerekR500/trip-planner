import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'

export type SelectedPlace = {
  name: string
  address: string | null
  placeId: string
  lat: number
  lng: number
}

type Props = {
  onSelect: (place: SelectedPlace) => void
  disabled?: boolean
}

/**
 * Thin React wrapper around google.maps.places.PlaceAutocompleteElement.
 *
 * PlaceAutocompleteElement is a native web component, not a React component, and
 * @vis.gl/react-google-maps does not wrap it — so we create it imperatively and mount it
 * into a div. useMapsLibrary('places') resolves against the script APIProvider already
 * loaded, so no second Maps script and no second API key is involved.
 *
 * The classic google.maps.places.Autocomplete is deliberately not used: since
 * 1 March 2025 it is unavailable to new customers, so it would simply fail here.
 */
export default function PlaceAutocomplete({ onSelect, disabled = false }: Props) {
  const places = useMapsLibrary('places')
  const containerRef = useRef<HTMLDivElement>(null)
  const elementRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep the newest onSelect in a ref so the effect below depends only on `places`.
  // Without this, a parent passing an inline arrow function would tear down and rebuild
  // the whole widget on every render, wiping whatever the user had typed.
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const container = containerRef.current
    if (!places || !container) return

    const element = new places.PlaceAutocompleteElement()
    element.placeholder = 'Search for a place…'
    elementRef.current = element
    container.appendChild(element)

    async function handleSelect(event: google.maps.places.PlacePredictionSelectEvent) {
      setError(null)
      try {
        const place = event.placePrediction.toPlace()

        // Only three fields are fetched — each extra field costs money. `id` is NOT
        // requestable here; it is already populated on the Place, so asking for it
        // would throw. The first fetchFields() on a Place produced by toPlace() reuses
        // the autocomplete's internal session token, so every keystroke plus this
        // lookup bills as ONE session rather than per-request.
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location'],
        })

        if (!place.location) {
          setError('That place has no coordinates, so it cannot be added.')
          return
        }

        onSelectRef.current({
          name: place.displayName ?? 'Unnamed place',
          address: place.formattedAddress ?? null,
          placeId: place.id,
          lat: place.location.lat(),
          lng: place.location.lng(),
        })

        element.value = '' // ready for the next search
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    function handleError() {
      setError('Place search failed. Check that Places API (New) is enabled for this key.')
    }

    element.addEventListener('gmp-select', handleSelect)
    element.addEventListener('gmp-error', handleError)

    return () => {
      element.removeEventListener('gmp-select', handleSelect)
      element.removeEventListener('gmp-error', handleError)
      element.remove()
      elementRef.current = null
    }
  }, [places])

  // Kept separate so toggling `disabled` doesn't rebuild the element.
  useEffect(() => {
    if (elementRef.current) elementRef.current.disabled = disabled
  }, [disabled])

  if (!places) return <p>Loading place search…</p>

  return (
    <div>
      <div ref={containerRef} />
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
