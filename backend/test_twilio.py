import os
from dotenv import load_dotenv
from twilio.rest import Client as TwilioClient

load_dotenv()

account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
auth_token  = os.getenv("TWILIO_AUTH_TOKEN", "")
from_number = os.getenv("TWILIO_FROM_NUMBER", "")
manager_phone = os.getenv("MANAGER_PHONE", "")

print("=== Twilio Test Config ===")
print(f"ACCOUNT_SID: {account_sid}")
print(f"AUTH_TOKEN:  {auth_token[:4]}...{auth_token[-4:] if auth_token else ''}")
print(f"FROM:        {from_number}")
print(f"TO:          {manager_phone}")
print("==========================")

try:
    client = TwilioClient(account_sid, auth_token)
    
    # 1. List verified numbers to see if it is verified
    print("\nFetching verified caller IDs...")
    verified_ids = client.outgoing_caller_ids.list()
    verified_numbers = [v.phone_number for v in verified_ids]
    print(f"Verified numbers in Twilio: {verified_numbers}")
    
    if manager_phone not in verified_numbers:
        print(f"\nWARNING: {manager_phone} is NOT in the verified caller IDs list!")
    else:
        print(f"\nSUCCESS: {manager_phone} is in the verified caller IDs list.")
        
    # 2. Attempt a call
    print("\nAttempting to trigger call...")
    twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-IN">This is a test call from the Smart Factory script. If you hear this, Twilio call integration is working perfectly.</Say>
</Response>"""
    call = client.calls.create(
        to=manager_phone,
        from_=from_number,
        twiml=twiml
    )
    print(f"Call successfully initiated! SID: {call.sid}, Status: {call.status}")
except Exception as e:
    print(f"\nError: {e}")
