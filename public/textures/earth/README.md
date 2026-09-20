# Earth surface texture

The day textures are derived from NASA Earth Observatory's **Blue Marble: Next
Generation — Base Map with Topography and Bathymetry**, May global mosaic.

- Source page: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
- High-resolution source: https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73701/world.topo.bathy.200405.3x21600x10800.jpg
- Original 4K source: https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73701/world.topo.bathy.200405.3x5400x2700.jpg
- Credit: NASA Earth Observatory / Blue Marble: Next Generation
- `earth-day-16k.jpg`: 16384 × 8192, Lanczos downsampling from the 21600 × 10800
  NASA source, JPEG quality 2 via FFmpeg
- `earth-day-8k.jpg`: 8192 × 4096, Lanczos downsampling from the 21600 × 10800
  NASA source, metadata removed, progressive JPEG quality 90
- `earth-day.jpg`: 4096 × 2048 fallback for devices with a WebGL maximum texture
  size below 8192 pixels

At runtime, the renderer selects the highest supported tier in this order:
16K, 8K, then 4K. The full 21600-pixel source is not used directly because it
exceeds the common WebGL maximum texture dimension of 16384 pixels.

The images use the standard equirectangular layout: north is at the top,
longitude 0° is at the horizontal center, and the antimeridian is at the seam.
