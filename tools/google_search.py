from tavily import TavilyClient
from dotenv import load_dotenv
import os
import json
from langchain.tools import tool

load_dotenv()
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

client = TavilyClient(api_key=TAVILY_API_KEY)


@tool
def search_web(query: str, max_results: int = 3):
    """Search Web for results
        Use this if you need the search the web for results

    Args:
        query : this is the search query you want to make
        max_results : this is the maximum amount of search results you want to make. Maximum query of query should only be 5 and default is 3.
    """
    response = client.search(
        query=query, max_results=max_results, search_depth="advanced"
    )
    return response["results"]


@tool
def search_page(page_urls: list):
    """Search specific URL page for results
    Use this when you are given specific urls to extract and make a research
    Args:
        page_urls : is a list of urls that you can extract data from
    """
    response = client.extract(urls=page_urls)
    return response["results"]


def read_content(load_json):
    with open(load_json, "r", encoding="utf-8") as f:
        content = json.load(f)
        extracted_content = [c["raw_content"] for c in content]
        print("\n\n".join(extracted_content))
