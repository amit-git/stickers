import os
import base64
import requests
from typing import Optional, Callable
from dataclasses import dataclass
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import threading
import webbrowser
import time


@dataclass
class PinData:
    title: str
    description: str
    image_url: str
    link: Optional[str] = None
    alt_text: Optional[str] = None
    dominant_color: Optional[str] = None


@dataclass
class PinterestTokens:
    access_token: str
    refresh_token: str
    expires_in: int
    refresh_token_expires_in: int
    scope: str
    token_type: str = "bearer"


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    auth_code = None
    state = None
    error = None

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if "code" in query:
            OAuthCallbackHandler.auth_code = query["code"][0]
            OAuthCallbackHandler.state = query.get("state", [None])[0]
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"""
                <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>Authorization Successful!</h1>
                    <p>You can close this window and return to the application.</p>
                </body>
                </html>
            """)
        elif "error" in query:
            OAuthCallbackHandler.error = query["error"][0]
            self.send_response(400)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(f"""
                <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>Authorization Failed</h1>
                    <p>Error: {OAuthCallbackHandler.error}</p>
                </body>
                </html>
            """.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


class PinterestOAuth:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        scopes: Optional[list[str]] = None
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.scopes = scopes or ["pins:write", "pins:read", "boards:read", "user_accounts:read"]
        self.auth_url = "https://www.pinterest.com/oauth/"
        self.token_url = "https://api.pinterest.com/v5/oauth/token"

    def get_authorization_url(self, state: Optional[str] = None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": ",".join(self.scopes)
        }
        if state:
            params["state"] = state

        from urllib.parse import quote
        query = "&".join([f"{k}={quote(str(v))}" for k, v in params.items()])
        return f"{self.auth_url}?{query}"

    def start_local_server(self, port: int = 8080, timeout: int = 120) -> Optional[str]:
        OAuthCallbackHandler.auth_code = None
        OAuthCallbackHandler.error = None

        server = HTTPServer(("localhost", port), OAuthCallbackHandler)
        server.timeout = timeout

        def serve():
            server.handle_request()

        thread = threading.Thread(target=serve)
        thread.daemon = True
        thread.start()

        auth_url = self.get_authorization_url()
        print(f"Opening browser for Pinterest authorization...")
        print(f"If browser doesn't open, visit: {auth_url}")
        webbrowser.open(auth_url)

        thread.join(timeout=timeout)
        server.server_close()

        if OAuthCallbackHandler.error:
            raise Exception(f"OAuth error: {OAuthCallbackHandler.error}")

        return OAuthCallbackHandler.auth_code

    def exchange_code_for_tokens(self, auth_code: str) -> PinterestTokens:
        credentials = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()

        headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

        data = {
            "grant_type": "authorization_code",
            "code": auth_code,
            "redirect_uri": self.redirect_uri
        }

        response = requests.post(self.token_url, headers=headers, data=data)
        response.raise_for_status()

        result = response.json()
        return PinterestTokens(
            access_token=result["access_token"],
            refresh_token=result["refresh_token"],
            expires_in=result["expires_in"],
            refresh_token_expires_in=result["refresh_token_expires_in"],
            scope=result["scope"],
            token_type=result.get("token_type", "bearer")
        )

    def refresh_access_token(self, refresh_token: str) -> PinterestTokens:
        credentials = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()

        headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }

        response = requests.post(self.token_url, headers=headers, data=data)
        response.raise_for_status()

        result = response.json()
        return PinterestTokens(
            access_token=result["access_token"],
            refresh_token=result.get("refresh_token", refresh_token),
            expires_in=result["expires_in"],
            refresh_token_expires_in=result.get("refresh_token_expires_in", 0),
            scope=result["scope"],
            token_type=result.get("token_type", "bearer")
        )


class PinterestPinCreator:
    def __init__(self, access_token: str):
        self.access_token = access_token
        self.base_url = "https://api.pinterest.com/v5"

    def create_pin(self, board_id: str, pin_data: PinData) -> dict:
        url = f"{self.base_url}/pins"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

        payload = {
            "board_id": board_id,
            "title": pin_data.title[:100],
            "description": pin_data.description[:800],
            "media_source": {
                "source_type": "image_url",
                "url": pin_data.image_url
            }
        }

        if pin_data.link:
            payload["link"] = pin_data.link[:2048]
        if pin_data.alt_text:
            payload["alt_text"] = pin_data.alt_text[:500]
        if pin_data.dominant_color:
            payload["dominant_color"] = pin_data.dominant_color

        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()

    def create_pin_from_base64(
        self,
        board_id: str,
        pin_data: PinData,
        image_data: bytes,
        content_type: str = "image/jpeg"
    ) -> dict:
        url = f"{self.base_url}/pins"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

        image_base64 = base64.b64encode(image_data).decode("utf-8")

        payload = {
            "board_id": board_id,
            "title": pin_data.title[:100],
            "description": pin_data.description[:800],
            "media_source": {
                "source_type": "image_base64",
                "content_type": content_type,
                "data": image_base64
            }
        }

        if pin_data.link:
            payload["link"] = pin_data.link[:2048]
        if pin_data.alt_text:
            payload["alt_text"] = pin_data.alt_text[:500]

        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()

    def get_boards(self) -> list[dict]:
        url = f"{self.base_url}/boards"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.json().get("items", [])


class PinterestClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        tokens: Optional[PinterestTokens] = None
    ):
        self.oauth = PinterestOAuth(client_id, client_secret, redirect_uri)
        self.tokens = tokens
        self._pin_creator = None

    def authenticate_interactive(self, port: int = 8080) -> PinterestTokens:
        auth_code = self.oauth.start_local_server(port=port)
        if not auth_code:
            raise Exception("Failed to get authorization code")

        self.tokens = self.oauth.exchange_code_for_tokens(auth_code)
        return self.tokens

    def refresh_token(self) -> PinterestTokens:
        if not self.tokens:
            raise Exception("No tokens available to refresh")

        self.tokens = self.oauth.refresh_access_token(self.tokens.refresh_token)
        return self.tokens

    @property
    def pin_creator(self) -> PinterestPinCreator:
        if not self.tokens:
            raise Exception("Not authenticated. Call authenticate_interactive() first.")

        if not self._pin_creator:
            self._pin_creator = PinterestPinCreator(self.tokens.access_token)

        return self._pin_creator


def create_pin(
    title: str,
    description: str,
    image_url: str,
    board_id: str,
    link: Optional[str] = None,
    alt_text: Optional[str] = None,
    access_token: Optional[str] = None
) -> dict:
    if not access_token:
        access_token = os.environ.get("PINTEREST_ACCESS_TOKEN")

    if not access_token:
        raise ValueError("PINTEREST_ACCESS_TOKEN environment variable not set")

    # Now access_token is guaranteed to be a non-None str
    token: str = access_token

    pin_data = PinData(
        title=title,
        description=description,
        image_url=image_url,
        link=link,
        alt_text=alt_text
    )

    creator = PinterestPinCreator(token)
    return creator.create_pin(board_id, pin_data)


if __name__ == "__main__":
    import json

    client_id = os.environ.get("PINTEREST_CLIENT_ID")
    client_secret = os.environ.get("PINTEREST_CLIENT_SECRET")
    redirect_uri = os.environ.get("PINTEREST_REDIRECT_URI", "http://localhost:8080/callback")

    if not client_id or not client_secret:
        print("Error: Set PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET environment variables")
        print("\nTo use this script:")
        print("1. Create a Pinterest app at https://developers.pinterest.com")
        print("2. Add http://localhost:8080/callback as a redirect URI")
        print("3. Set the environment variables above")
        print("4. Run this script and authorize when prompted")
        exit(1)

    client = PinterestClient(client_id, client_secret, redirect_uri)

    print("Starting Pinterest OAuth flow...")
    print("A browser window will open for authorization.\n")

    try:
        tokens = client.authenticate_interactive(port=8080)

        print("\n" + "="*50)
        print("AUTHENTICATION SUCCESSFUL!")
        print("="*50)
        print(f"\nAccess Token: {tokens.access_token[:20]}...")
        print(f"Refresh Token: {tokens.refresh_token[:20]}...")
        print(f"Expires In: {tokens.expires_in} seconds ({tokens.expires_in // 86400} days)")
        print(f"Scope: {tokens.scope}")
        print("\nSave these tokens securely!")
        print("="*50)

        print("\nFetching your boards...")
        boards = client.pin_creator.get_boards()
        print(f"Found {len(boards)} boards:")
        for board in boards:
            print(f"  - {board.get('name')} (ID: {board.get('id')})")

    except Exception as e:
        print(f"\nError: {e}")
        exit(1)
