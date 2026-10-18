import io
import requests
from pypdf import PdfReader

def extract_text_from_pdf(pdf_url : str):
  """
  Downloads a PDF from its URL and extracts all its text from memory
  """
  
  if not pdf_url:
    return ""
  
  
  try:
    response = requests.get(pdf_url)
    response.raise_for_status() # throws error if download fails
    
    #Read PDF directly from memory 
    
    reader = PdfReader(io.BytesIO(response.content))
    text =""
    for page in reader.pages:
      text+= page.extract_text() + "\n"
    return text
  except Exception as e:
    print(f"Extraction error from PDF: {e}")
    return "CV couldn't be processed."
  
  
