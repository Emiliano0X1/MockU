import os
import assemblyai as aai
from dotenv import load_dotenv

load_dotenv()

aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")

def transcribe_audio(audio_source: str) -> dict:
  """
  Takes local path of an audio file or its URL and transcribes it
  
  Returns a dict with full text and the timestamps of each word
  """
  
  if not aai.settings.api_key:
    raise ValueError("Assembly AI API key not configured in .env")
  
  transcriber  = aai.Transcriber()
  
  # sync call, blocks execution until its done
  transcript = transcriber.transcribe(audio_source)
  
  if transcript.status == aai.TranscriptStatus.error:
    raise Exception(f"Assembly AI error: {transcript.error}")
  
  #Format output for NLP phase
  
  words_data = [{
    "text": w.text,
    "start": w.start, #in miliseconds
    "end":w.end #in miliseconds
  }
  for w in (transcript.words or [])  # None when the audio has no speech
  ]
  
  return{
    "full_text":transcript.text,
    "words":words_data
  }
  