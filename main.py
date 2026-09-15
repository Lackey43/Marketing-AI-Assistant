from langchain_google_genai import ChatGoogleGenerativeAI
from deepagents import create_deep_agent
from tools.email_sender import send_email
from tools.google_search import search_page, search_web
from dotenv import load_dotenv
import os
from deepagents.backends import StateBackend
from pydantic import BaseModel, Field
from langgraph.checkpoint.memory import MemorySaver
from langchain_openrouter import ChatOpenRouter
from prompts.prompts import main_agent

load_dotenv()

checkpointer = MemorySaver()


class ContextSchema(BaseModel):
    userName: str = Field(description="Name or Email Address of User")


skills_directory = "./Agent/skills"
memories_directory = "./Agent/memories"
API_KEY = os.getenv("GOOGLE_API_KEY")
# API_KEY = os.getenv("OPENROUTER_API_KEY")

# model = ChatOpenRouter(model="nvidia/nemotron-3-ultra-550b-a55b:free", api_key=API_KEY)
model = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key=API_KEY)


agent = create_deep_agent(
    model=model,
    tools=[send_email, search_page, search_web],
    system_prompt=main_agent,
    skills=["/skills"],
    memory=["/memories/Agent.md"],
    backend=StateBackend(),
    checkpointer=checkpointer,
)


if __name__ == "__main__":
    user = "Claude"
    while True:
        query = input("enter here:\n")
        if query.lower() in ["quit", "exit"]:
            break
        message = {
            "role": "user",
            "content": query,
        }
        config = {"configurable": {"thread_id": user}}

        response = agent.invoke(
            {"messages": query},
            config=config,
        )
        print(response["messages"][-1].content[-1]["text"])
