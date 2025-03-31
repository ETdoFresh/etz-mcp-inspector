export async function initializeBuildInfo() {
    try {
        // Fetch the build timestamp from build_time.txt
        const response = await fetch('/build_time.txt');
        if (!response.ok) {
            throw new Error(`Failed to fetch build timestamp: ${response.statusText}`);
        }
        const buildTime = await response.text();

        // Update the timestamp element
        const timestampElement = document.getElementById('build-timestamp');
        if (timestampElement) {
            timestampElement.textContent = buildTime.trim();
        }
    } catch (error) {
        console.error('Failed to initialize build info:', error);
    }
} 