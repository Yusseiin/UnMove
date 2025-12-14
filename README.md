# Unmove

A self-hosted web application to organize your media library by identifying files using TVDB (The TV Database) and moving them with proper naming conventions.

![License](https://img.shields.io/github/license/yusseiin/unmove)
![Docker Pulls](https://img.shields.io/docker/pulls/yusseiin/unmove)

## Features

- **File Browser** - Browse your downloads folder with parsed information (title, year, season, episode)
- **TVDB Integration** - Search and identify movies/TV shows using the TVDB API
- **Auto-Match** - Automatically matches files to TVDB results based on filename similarity
- **Batch Processing** - Identify and move multiple files at once
- **Smart Renaming** - Automatically renames files following media server conventions (Plex/Jellyfin/Emby compatible)
- **Configurable Paths** - Set custom download and media library paths

## Screenshots

*Coming soon*

## Installation

### Docker (Recommended)

```bash
docker run -d \
  --name unmove \
  -p 3000:3000 \
  -e PUID=99 \
  -e PGID=100 \
  -v /path/to/downloads:/downloads \
  -v /path/to/media:/media \
  -v /path/to/config:/config \
  yusseiin/unmove:latest
```

### Docker Compose

```yaml
version: "3.8"
services:
  unmove:
    image: yusseiin/unmove:latest
    container_name: unmove
    ports:
      - "3000:3000"
    environment:
      - PUID=99
      - PGID=100
    volumes:
      - /path/to/downloads:/downloads
      - /path/to/media:/media
      - /path/to/config:/config
    restart: unless-stopped
```

### Unraid

Available in Community Applications. Search for "unmove" or install manually using the Docker Hub image `yusseiin/unmove:latest`.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PUID` | 99 | User ID for file permissions |
| `PGID` | 100 | Group ID for file permissions |

### Volumes

| Container Path | Description |
|----------------|-------------|
| `/downloads` | Your downloads folder (source) |
| `/media` | Your media library (destination) |
| `/config` | Configuration storage |

### TVDB API Key

1. Create a free account at [thetvdb.com](https://thetvdb.com)
2. Go to [API Information](https://thetvdb.com/api-information) and generate an API key
3. Enter your API key in the env

### Application Settings

Settings are accessible via the gear icon in the top-right corner of the interface and are stored in `/config/unmove-config.json`.

| Setting | Default | Description |
|---------|---------|-------------|
| **Language** | `en` | Interface language and folder naming. Options: `en` (English), `it` (Italian). Affects season folder names (e.g., "Season 01" vs "Stagione 01") |
| **Series Base Folders** | `[]` | List of subfolders in your media library for TV series (e.g., `["TV Series", "Anime", "Documentaries"]`). When identifying a series, you can choose which folder to place it in |
| **Movies Base Folders** | `[]` | List of subfolders in your media library for movies (e.g., `["Movies", "4K Movies", "Documentaries"]`). When identifying a movie, you can choose which folder to place it in |
| **Movie Folder Structure** | `name` | How movie files are organized. Options: `name` (Movie Name (Year)/Movie.mkv) or `year` (Year/Movie.mkv) |
| **Preserve Quality Info** | `false` | When enabled, keeps quality and encoding information in renamed files. Example: `Avatar - The Way of Water (2022) [1080p.x265].mkv` instead of `Avatar - The Way of Water (2022).mkv` |

#### Example unmove-config.json

```json
{
  "language": "en",
  "seriesBaseFolders": ["TV Series", "Anime"],
  "moviesBaseFolders": ["Movies", "4K Movies"],
  "movieFolderStructure": "name",
  "preserveQualityInfo": true
}
```

#### Naming Examples

**TV Series** with `seriesBaseFolders: ["TV Series"]` and `preserveQualityInfo: true`:
```
/media/TV Series/Breaking Bad (2008)/Season 01/Breaking Bad - S01E01 - Pilot [1080p.x264].mkv
```

**Movies** with `moviesBaseFolders: ["Movies"]` and `movieFolderStructure: "name"`:
```
/media/Movies/Avatar - The Way of Water (2022)/Avatar - The Way of Water (2022) [2160p.x265].mkv
```

**Movies** with `moviesBaseFolders: ["4K Movies"]` and `movieFolderStructure: "year"`:
```
/media/4K Movies/2022/Avatar - The Way of Water (2022) [2160p.x265].mkv
```

## Usage

1. Open the web interface at `http://your-server:3000`
2. Click the gear icon and select your preference
3. Browse your downloads folder
4. Select files to identify
5. Use "Identify" for single files or "Batch Identify" for multiple files
6. Review the matches and move files to your media library

## Development

### Prerequisites

- Node.js 22+
- pnpm

### Setup

```bash
# Clone the repository
git clone https://github.com/yusseiin/unmove.git
cd unmove

# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with your paths

# Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Building

```bash
# Build for production
pnpm build

# Start production server
pnpm start
```

### Docker Build

```bash
docker build --build-arg NEXT_PUBLIC_VERSION=0.0.1 -t unmove .
```

## Tech Stack

- [Next.js 16](https://nextjs.org/) - React framework
- [React 19](https://react.dev/) - UI library
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [TVDB API](https://thetvdb.com/api-information) - Media database

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/yusseiin/unmove/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yusseiin/unmove/discussions)

## Acknowledgments

- [TVDB](https://thetvdb.com/) for providing the media database API
- [Unraid](https://unraid.net/) community for testing and feedback
