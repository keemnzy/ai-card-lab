from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI()

response = client.chat.completions.create(
    model="gpt-3.5-turbo",        # ← 비용이 훨씬 저렴해요
    messages=[{"role": "user", "content": "안녕 GPT, 한국어로 대답해줘"}]
)
print(response.choices[0].message.content)
