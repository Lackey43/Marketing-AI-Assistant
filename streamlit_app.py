import streamlit as st
from dotenv import load_dotenv
import os
from langchain_google_genai import ChatGoogleGenerativeAI
from deepagents import create_deep_agent
from deepagents.backends import StateBackend
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel, Field

# Import your tools and prompt
from tools.email_sender import send_email
from tools.google_search import search_page, search_web
from prompts.prompts import main_agent

load_dotenv()

# ========================= CONFIG =========================
st.set_page_config(
    page_title="Marketing AI Assistant",
    page_icon="📧",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ====================== SESSION STATE ======================
if "messages" not in st.session_state:
    st.session_state.messages = []

if "agent" not in st.session_state:
    checkpointer = MemorySaver()

    class ContextSchema(BaseModel):
        userName: str = Field(
            description="Name or Email Address of User", default="Demo User"
        )

    model = ChatGoogleGenerativeAI(
        model="gemini-3.1-flash-lite", api_key=os.getenv("GOOGLE_API_KEY")
    )

    agent = create_deep_agent(
        model=model,
        tools=[send_email, search_page, search_web],
        system_prompt=main_agent,
        skills=["/skills"],
        memory=["/memories/Agent.md"],
        backend=StateBackend(),
        checkpointer=checkpointer,
    )
    st.session_state.agent = agent

# ========================= LAYOUT =========================
st.title("📧 Marketing AI Assistant")
st.markdown("**Research businesses • Craft personalized emails**")

# Sidebar
with st.sidebar:
    st.header("About")
    st.write(
        "This AI Marketing Assistant researches companies and drafts high-quality outreach emails."
    )
    st.markdown(
        """
        ## Instructions:

        Follow the steps below to generate a personalized outreach email using the Outreach Email Agent.

        ### Step 1: Describe the Company

        Provide information about the company you want to send an outreach email to.

        You can do this in either of the following ways:

        **Option 1: Copy and paste company details**
        - Include the company name, 
        - services 
        - products 
        - target audience 
        - or any other relevant information

        **Option 2: Paste the company website link**
        - Provide the URL of the company's website.
        - The Agent will analyze the website information and use it to create a personalized outreach email.

        # Example:
        please do a research on apple company
        then send an outreach email
        to: your_email_address@gmail.com
        """
    )
    st.divider()
    st.caption("Built with Deep Agents + Gemini 3.1 Flash Lite")

# Main Chat Interface
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# Chat Inp t
if prompt := st.chat_input("Describe the business or campaign..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Researching + drafting..."):
            response = st.session_state.agent.invoke(
                {"messages": prompt},
                config={"configurable": {"thread_id": "portfolio_demo"}},
            )
            final_text = response["messages"][-1].content
            if isinstance(final_text, list):
                final_text = final_text[-1].get("text", str(final_text))

            st.markdown(final_text)
            st.session_state.messages.append(
                {"role": "assistant", "content": final_text}
            )

# Footer
st.divider()
st.markdown(
    "<p style='text-align: center; color: gray;'>"
    "Claude's Demo • Marketing AI Assistant</p>",
    unsafe_allow_html=True,
)
