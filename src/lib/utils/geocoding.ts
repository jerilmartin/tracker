/**
 * Reverse geocodes coordinates using OpenStreetMap (Nominatim)
 * Note: Nominatim usage policy requires a unique User-Agent and a limit of 1 request per second.
 */
export async function getAddressFromCoords(lat: number, lng: number): Promise<string> {
    if (!lat || !lng) return 'N/A'

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
            {
                headers: {
                    'Accept-Language': 'en',
                    'User-Agent': 'TVK-Track-Admin-Dashboard'
                }
            }
        )

        if (!response.ok) {
            throw new Error(`Geocoding error: ${response.statusText}`)
        }

        const data = await response.json()

        if (data.address) {
            const a = data.address
            // Construct a shorter, more readable address for Excel
            // Priority: [Road/Suburb/Village], [City/Town], [District]
            const local = a.road || a.suburb || a.village || a.neighbourhood || ''
            const city = a.city || a.town || a.municipality || ''
            const district = a.county || a.district || ''

            const parts = [local, city, district].filter(Boolean)
            if (parts.length > 0) return parts.join(', ')
        }

        return data.display_name || `${lat}, ${lng}`
    } catch (error) {
        console.error('Reverse geocoding failed:', error)
        return `${lat}, ${lng}` // Fallback to raw coordinates
    }
}
