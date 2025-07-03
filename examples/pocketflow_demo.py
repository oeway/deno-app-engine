#!/usr/bin/env python3
"""
PocketFlow Integration Demo
===========================

This demonstrates the integration of PocketFlow (100-line LLM framework) 
with the Python kernel, showing modern agent patterns and workflows.

Run this in the Python kernel to see PocketFlow in action!
"""

import sys
import os

# Add the kernel path to import PocketFlow utilities
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'kernel', 'py'))

# Import PocketFlow utilities
from pocketflow_utils import (
    SharedState, Node, Flow, LLMNode, DecisionNode, 
    DataTransformNode, create_simple_agent, create_research_agent
)

def demo_basic_flow():
    """Demonstrate basic PocketFlow functionality"""
    print("🚀 PocketFlow Demo: Basic Flow")
    print("=" * 50)
    
    class WelcomeNode(Node):
        def prep(self, shared):
            return shared.get("name", "World")
        
        def exec(self, name):
            return f"Hello, {name}! Welcome to PocketFlow."
        
        def post(self, shared, prep_res, exec_res):
            shared["greeting"] = exec_res
            print(f"✅ {exec_res}")
            return "process"
    
    class ProcessNode(Node):
        def prep(self, shared):
            return shared.get("greeting", "")
        
        def exec(self, greeting):
            word_count = len(greeting.split())
            return f"Your greeting has {word_count} words."
        
        def post(self, shared, prep_res, exec_res):
            shared["analysis"] = exec_res
            print(f"📊 {exec_res}")
            return "done"
    
    # Create and connect nodes
    welcome = WelcomeNode()
    process = ProcessNode()
    welcome >> process
    
    # Create flow and run
    flow = Flow(start_node=welcome)
    state = SharedState({"name": "PocketFlow User"})
    
    result = flow.run(state)
    print(f"🎯 Flow completed with result: {result}")
    print(f"💾 Final state: {state.to_dict()}")
    print()

def demo_research_agent():
    """Demonstrate a research agent pattern"""
    print("🔍 PocketFlow Demo: Research Agent")
    print("=" * 50)
    
    class MockDecisionNode(DecisionNode):
        def __init__(self):
            super().__init__(
                decision_prompt="Should we search or answer?",
                actions=["search", "answer"]
            )
            self.decision_count = 0
        
        def call_llm(self, prompt, **kwargs):
            self.decision_count += 1
            print(f"🤔 Making decision #{self.decision_count}")
            
            # First time: search, second time: answer
            if self.decision_count == 1:
                return "We need to search for more information first."
            else:
                return "Now we have enough information to answer."
    
    class MockSearchNode(Node):
        def prep(self, shared):
            return shared.get("question", "")
        
        def exec(self, question):
            print(f"🌐 Searching for: {question}")
            # Mock search results
            if "python" in question.lower():
                return "Python is a high-level programming language created by Guido van Rossum."
            elif "ai" in question.lower():
                return "AI (Artificial Intelligence) refers to machine intelligence and learning."
            else:
                return f"Search results related to: {question}"
        
        def post(self, shared, prep_res, exec_res):
            current_context = shared.get("context", "")
            shared["context"] = current_context + "\nSearch: " + exec_res
            print(f"📚 Added to context: {exec_res[:50]}...")
            return "decide"
    
    class MockAnswerNode(Node):
        def prep(self, shared):
            question = shared.get("question", "")
            context = shared.get("context", "")
            return f"Question: {question}\nContext: {context}"
        
        def exec(self, prompt):
            print("✍️ Generating final answer...")
            return f"Based on my research, here's the answer to your question: {prompt.split('Question: ')[1].split('Context:')[0].strip()}"
        
        def post(self, shared, prep_res, exec_res):
            shared["answer"] = exec_res
            print(f"💡 Final answer ready!")
            return "complete"
    
    # Build the research agent
    decision = MockDecisionNode()
    search = MockSearchNode()
    answer = MockAnswerNode()
    
    # Connect nodes with conditional flow
    decision - "search" >> search
    decision - "answer" >> answer
    search - "decide" >> decision
    
    # Create and run the research flow
    research_agent = Flow(start_node=decision)
    state = SharedState({"question": "What is Python programming?"})
    
    print(f"❓ Question: {state['question']}")
    result = research_agent.run(state)
    
    print(f"🎯 Research completed with result: {result}")
    print(f"📖 Final answer: {state.get('answer', 'No answer generated')}")
    print()

def demo_data_pipeline():
    """Demonstrate data transformation pipeline"""
    print("⚙️ PocketFlow Demo: Data Pipeline")
    print("=" * 50)
    
    def clean_text(text):
        """Clean and normalize text"""
        return text.strip().lower().replace("  ", " ")
    
    def extract_keywords(text):
        """Extract keywords from text"""
        stop_words = {"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"}
        words = text.split()
        keywords = [word for word in words if word not in stop_words and len(word) > 2]
        return keywords[:5]  # Top 5 keywords
    
    def create_summary(keywords):
        """Create a summary from keywords"""
        if not keywords:
            return "No significant keywords found."
        return f"Key topics: {', '.join(keywords)}"
    
    # Create transformation pipeline
    cleaner = DataTransformNode(clean_text, "raw_text", "clean_text")
    extractor = DataTransformNode(extract_keywords, "clean_text", "keywords")  
    summarizer = DataTransformNode(create_summary, "keywords", "summary")
    
    # Connect pipeline
    cleaner >> extractor >> summarizer
    
    # Create flow and process data
    pipeline = Flow(start_node=cleaner)
    state = SharedState({
        "raw_text": "  The Future of Artificial Intelligence and Machine Learning in Modern Applications  "
    })
    
    print(f"📥 Input: {state['raw_text']}")
    result = pipeline.run(state)
    
    print(f"🧹 Cleaned: {state.get('clean_text', '')}")
    print(f"🔑 Keywords: {state.get('keywords', [])}")
    print(f"📋 Summary: {state.get('summary', '')}")
    print(f"✅ Pipeline result: {result}")
    print()

def demo_customer_support():
    """Demonstrate customer support agent"""
    print("🎧 PocketFlow Demo: Customer Support Agent")
    print("=" * 50)
    
    class ClassifyRequestNode(DecisionNode):
        def __init__(self):
            super().__init__(
                decision_prompt="Classify customer request",
                actions=["technical", "billing", "general"]
            )
        
        def call_llm(self, prompt, **kwargs):
            print("🔍 Classifying customer request...")
            request = prompt.lower()
            
            if any(word in request for word in ["password", "login", "account", "error"]):
                return "This appears to be a technical support issue."
            elif any(word in request for word in ["payment", "bill", "charge", "refund"]):
                return "This appears to be a billing inquiry."
            else:
                return "This appears to be a general inquiry."
    
    class TechnicalSupportNode(Node):
        def prep(self, shared):
            return shared.get("request", "")
        
        def exec(self, request):
            print("🔧 Routing to technical support...")
            return f"Technical Support Response: We'll help you with '{request}'. Please check your account settings and try again."
        
        def post(self, shared, prep_res, exec_res):
            shared["response"] = exec_res
            shared["department"] = "Technical Support"
            return "resolved"
    
    class BillingSupportNode(Node):
        def prep(self, shared):
            return shared.get("request", "")
        
        def exec(self, request):
            print("💳 Routing to billing department...")
            return f"Billing Support Response: We've reviewed your account regarding '{request}'. Our billing team will contact you within 24 hours."
        
        def post(self, shared, prep_res, exec_res):
            shared["response"] = exec_res
            shared["department"] = "Billing"
            return "resolved"
    
    class GeneralSupportNode(Node):
        def prep(self, shared):
            return shared.get("request", "")
        
        def exec(self, request):
            print("💬 Routing to general support...")
            return f"General Support Response: Thank you for your inquiry about '{request}'. We're here to help and will provide more information shortly."
        
        def post(self, shared, prep_res, exec_res):
            shared["response"] = exec_res
            shared["department"] = "General Support"
            return "resolved"
    
    # Build support agent
    classifier = ClassifyRequestNode()
    technical = TechnicalSupportNode()
    billing = BillingSupportNode()
    general = GeneralSupportNode()
    
    # Connect classification to appropriate departments
    classifier - "technical" >> technical
    classifier - "billing" >> billing
    classifier - "general" >> general
    
    support_agent = Flow(start_node=classifier)
    
    # Test different types of requests
    test_requests = [
        "I can't login to my account, getting error 404",
        "I was charged twice for my subscription this month",
        "What are your business hours and locations?"
    ]
    
    for i, request in enumerate(test_requests, 1):
        print(f"\n📞 Customer Request #{i}: {request}")
        state = SharedState({"request": request})
        
        result = support_agent.run(state)
        
        print(f"🏢 Routed to: {state.get('department', 'Unknown')}")
        print(f"💬 Response: {state.get('response', 'No response')}")
    
    print()

def main():
    """Run all demonstrations"""
    print("🎉 Welcome to PocketFlow Integration Demo!")
    print("This showcases the 100-line LLM framework in action.")
    print("=" * 60)
    print()
    
    try:
        # Run all demos
        demo_basic_flow()
        demo_research_agent()  
        demo_data_pipeline()
        demo_customer_support()
        
        print("🎊 All demonstrations completed successfully!")
        print("✨ PocketFlow shows how simple, elegant code can power complex AI workflows.")
        print("📚 Try modifying the examples above to create your own agents!")
        
    except Exception as e:
        print(f"❌ Error during demo: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()