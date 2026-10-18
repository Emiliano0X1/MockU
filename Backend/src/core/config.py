import os
from dotenv import load_dotenv
# pyrefly: ignore[missing-import]
from supabase import create_client, Client

# Load environment variables from .env
load_dotenv()

SUPABASE_URL: str = os.getenv("SUPABASE_URL") or "https://placeholder.supabase.co"
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY") or "placeholder-key"

# Shared Supabase client instance (reuses session and connection across the app)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
