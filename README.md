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
3. Enter your API key in the app settings (gear icon)

## Usage

1. Open the web interface at `http://your-server:3000`
2. Click the gear icon and enter your TVDB API key
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

- [Next.js 15](https://nextjs.org/) - React framework
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
