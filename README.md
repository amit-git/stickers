# Sticker Shop

A full-stack sticker e-commerce application with Pinterest integration for marketing automation.

## Overview

This project consists of a Node.js web server for browsing sticker products and a Python tool for creating Pinterest pins programmatically. The product catalog is imported from Etsy CSV exports.

## Project Structure

```
sticker-shop/
├── web/                          # Web application
│   ├── server.js                 # Node.js HTTP server
│   ├── package.json              # Node.js dependencies
│   └── public/
│       └── index.html            # Frontend UI (vanilla JS/CSS)
├── pinterest_pin_creator.py      # Pinterest API integration
├── sticker-products.csv          # Product catalog (Etsy export)
└── EtsyListingsDownload.csv      # Raw Etsy data export
```

## Features

### Web Shop (`web/`)

- **Product Catalog**: Browse stickers, bookmarks, and notepads
- **Search & Filter**: Search by title/tag, filter by product category
- **Sorting**: Sort by featured, lowest/highest price
- **Product Modal**: Quick view with image gallery and description
- **Shopping Cart**: Add items, adjust quantities, persistent with localStorage
- **Responsive Design**: Mobile-friendly with sidebar drawer
- **Clean UI**: Warm, cozy aesthetic with blush and sage color palette

### Pinterest Integration (`pinterest_pin_creator.py`)

- **OAuth Authentication**: Interactive browser-based authorization flow
- **Token Management**: Automatic access token refresh
- **Pin Creation**: Create pins from image URLs or base64 data
- **Board Management**: List and access Pinterest boards

## Quick Start

### Prerequisites

- Node.js 14+
- Python 3.8+
- Pinterest Developer Account (for pin creation)

### Web Server

```bash
cd web
npm start
# Server runs on http://localhost:3000
```

### Pinterest Authentication

Set environment variables:
```bash
export PINTEREST_CLIENT_ID="your_client_id"
export PINTEREST_CLIENT_SECRET="your_client_secret"
export PINTEREST_REDIRECT_URI="http://localhost:8080/callback"
```

Run authentication flow:
```bash
python pinterest_pin_creator.py
```

Follow the browser prompts to authorize. Save the access token for API calls.

### Create a Pin

```python
from pinterest_pin_creator import create_pin

# Using environment variable PINTEREST_ACCESS_TOKEN
create_pin(
    title="Cute Vinyl Sticker",
    description="Waterproof vinyl sticker for laptops and water bottles",
    image_url="https://example.com/sticker.jpg",
    board_id="your_board_id",
    link="https://yourshop.com/product/123",
    alt_text="Cute vinyl sticker illustration"
)
```

## API Endpoints

The web server exposes these JSON endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/products` | List products (supports `search`, `tag`, `sort`, `page`, `limit`) |
| `GET /api/tags` | List available product category tags |
| `GET /api/product/:id` | Get single product details |

## Product Categories

Products are automatically categorized based on title and tags:
- **Stickers** - Default category for vinyl decals
- **Bookmarks** - Paper bookmarks
- **Magnetic Bookmarks** - Magnetic page markers
- **Notepads** - Stationery notepads

## Development

### Web Frontend

The frontend is built with vanilla JavaScript and CSS (no build step required). Key features:
- Client-side state management
- Debounced search input
- Skeleton loaders for perceived performance
- Accessible modal and drawer components

### Pinterest API

The Pinterest integration uses the Pinterest API v5 with:
- OAuth 2.0 authorization code flow
- PKCE-less implementation (for server-side apps)
- Automatic token refresh before expiry

## Data Format

The application expects `sticker-products.csv` with these columns:
- `TITLE` - Product title
- `DESCRIPTION` - Product description
- `PRICE` - Product price
- `CURRENCY_CODE` - Currency (e.g., USD)
- `IMAGE1` through `IMAGE10` - Product image URLs
- `TAGS` - Comma-separated product tags

## License

MIT
