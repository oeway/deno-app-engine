# PocketFlow Python Bridge - Utilities for using PocketFlow from Python in Pyodide
# This provides a Python interface to the TypeScript PocketFlow framework

import json
from typing import Any, Dict, List, Optional, Union, Callable
from abc import ABC, abstractmethod
import asyncio

class SharedState:
    """Python wrapper for PocketFlow SharedState"""
    def __init__(self, initial_data: Optional[Dict[str, Any]] = None):
        self.data = initial_data or {}
    
    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        self.data[key] = value
    
    def update(self, updates: Dict[str, Any]) -> None:
        self.data.update(updates)
    
    def to_dict(self) -> Dict[str, Any]:
        return self.data.copy()
    
    def __getitem__(self, key: str) -> Any:
        return self.data[key]
    
    def __setitem__(self, key: str, value: Any) -> None:
        self.data[key] = value
    
    def __contains__(self, key: str) -> bool:
        return key in self.data

class BaseNode(ABC):
    """Base class for PocketFlow nodes in Python"""
    
    def __init__(self):
        self.params: Dict[str, Any] = {}
        self.successors: Dict[str, 'BaseNode'] = {}
    
    def set_params(self, params: Dict[str, Any]) -> None:
        self.params = params
    
    def next(self, node: 'BaseNode', action: str = "default") -> 'BaseNode':
        if action in self.successors:
            print(f"Warning: Overwriting successor for action '{action}'")
        self.successors[action] = node
        return node
    
    @abstractmethod
    def prep(self, shared: SharedState) -> Any:
        """Prepare data for execution"""
        pass
    
    @abstractmethod
    def exec(self, prep_res: Any) -> Any:
        """Execute the main logic"""
        pass
    
    @abstractmethod
    def post(self, shared: SharedState, prep_res: Any, exec_res: Any) -> Optional[str]:
        """Post-process results and return next action"""
        pass
    
    def _exec(self, prep_res: Any) -> Any:
        return self.exec(prep_res)
    
    def _run(self, shared: SharedState) -> Optional[str]:
        prep_res = self.prep(shared)
        exec_res = self._exec(prep_res)
        return self.post(shared, prep_res, exec_res)
    
    def run(self, shared: SharedState) -> Optional[str]:
        if self.successors:
            print("Warning: Node won't run successors. Use Flow.")
        return self._run(shared)
    
    def __rshift__(self, other: 'BaseNode') -> 'BaseNode':
        """Operator overloading for >> to connect nodes"""
        return self.next(other)
    
    def __sub__(self, action: str) -> 'ConditionalTransition':
        """Operator overloading for - to create conditional transitions"""
        return ConditionalTransition(self, action)

class ConditionalTransition:
    """Helper class for conditional node transitions"""
    
    def __init__(self, src: BaseNode, action: str):
        self.src = src
        self.action = action
    
    def __rshift__(self, target: BaseNode) -> BaseNode:
        return self.src.next(target, self.action)

class Node(BaseNode):
    """Standard PocketFlow node with retry logic"""
    
    def __init__(self, max_retries: int = 1, wait: float = 0):
        super().__init__()
        self.max_retries = max_retries
        self.wait = wait
    
    def exec_fallback(self, prep_res: Any, exc: Exception) -> Any:
        """Fallback execution when all retries fail"""
        raise exc
    
    def _exec(self, prep_res: Any) -> Any:
        for retry in range(self.max_retries):
            try:
                return self.exec(prep_res)
            except Exception as e:
                if retry == self.max_retries - 1:
                    return self.exec_fallback(prep_res, e)
                if self.wait > 0:
                    import time
                    time.sleep(self.wait)

class Flow(BaseNode):
    """PocketFlow Flow for orchestrating nodes"""
    
    def __init__(self, start_node: Optional[BaseNode] = None):
        super().__init__()
        self.start_node = start_node
    
    def start(self, start_node: BaseNode) -> BaseNode:
        self.start_node = start_node
        return start_node
    
    def get_next_node(self, current: BaseNode, action: Optional[str]) -> Optional[BaseNode]:
        # First try the specific action
        next_node = current.successors.get(action or "default")
        
        # If not found and there's only one successor, use it (for linear flows)
        if not next_node and len(current.successors) == 1:
            next_node = list(current.successors.values())[0]
        
        # If not found and there's a default successor, use it
        if not next_node and "default" in current.successors:
            next_node = current.successors["default"]
        
        # Only warn if we have successors but can't find a match
        if not next_node and current.successors:
            print(f"Warning: Flow ends: '{action}' not found in {list(current.successors.keys())}")
        
        return next_node
    
    def _orch(self, shared: SharedState, params: Optional[Dict[str, Any]] = None) -> Optional[str]:
        if not self.start_node:
            raise ValueError("Start node not set")
        
        current = self.start_node
        p = params or {**self.params}
        last_action = None
        
        while current:
            current.set_params(p)
            last_action = current._run(shared)
            current = self.get_next_node(current, last_action)
        
        return last_action
    
    def prep(self, shared: SharedState) -> Any:
        return None
    
    def exec(self, prep_res: Any) -> Any:
        return None
    
    def post(self, shared: SharedState, prep_res: Any, exec_res: Any) -> Optional[str]:
        return exec_res
    
    def _run(self, shared: SharedState) -> Optional[str]:
        prep_res = self.prep(shared)
        orch_res = self._orch(shared)
        return self.post(shared, prep_res, orch_res)

# LLM Integration utilities
class LLMNode(Node):
    """Base class for nodes that interact with LLMs"""
    
    def __init__(self, model_name: str = "gpt-3.5-turbo", max_retries: int = 3):
        super().__init__(max_retries=max_retries)
        self.model_name = model_name
    
    def call_llm(self, prompt: str, **kwargs) -> str:
        """Call LLM with the given prompt"""
        # This will be implemented to call the actual LLM API
        # For now, return a placeholder
        return f"LLM Response to: {prompt[:50]}..."
    
    def format_prompt(self, template: str, **kwargs) -> str:
        """Format a prompt template with given parameters"""
        return template.format(**kwargs)

# Common Node implementations
class LLMCallNode(LLMNode):
    """Node for making LLM calls"""
    
    def __init__(self, prompt_template: str, output_key: str = "llm_output", **kwargs):
        super().__init__(**kwargs)
        self.prompt_template = prompt_template
        self.output_key = output_key
    
    def prep(self, shared: SharedState) -> str:
        # Format the prompt with data from shared state
        return self.format_prompt(self.prompt_template, **shared.to_dict())
    
    def exec(self, prompt: str) -> str:
        return self.call_llm(prompt)
    
    def post(self, shared: SharedState, prep_res: str, exec_res: str) -> Optional[str]:
        shared[self.output_key] = exec_res
        return "default"

class DecisionNode(LLMNode):
    """Node for making decisions based on LLM responses"""
    
    def __init__(self, decision_prompt: str, actions: List[str], **kwargs):
        super().__init__(**kwargs)
        self.decision_prompt = decision_prompt
        self.actions = actions
    
    def prep(self, shared: SharedState) -> str:
        actions_text = "\n".join(f"- {action}" for action in self.actions)
        full_prompt = f"{self.decision_prompt}\n\nAvailable actions:\n{actions_text}\n\nChoose one action:"
        return self.format_prompt(full_prompt, **shared.to_dict())
    
    def exec(self, prompt: str) -> str:
        response = self.call_llm(prompt)
        # Extract action from response (simplified)
        for action in self.actions:
            if action.lower() in response.lower():
                return action
        return self.actions[0]  # Default to first action
    
    def post(self, shared: SharedState, prep_res: str, exec_res: str) -> Optional[str]:
        shared["last_decision"] = exec_res
        return exec_res

class DataTransformNode(Node):
    """Node for transforming data"""
    
    def __init__(self, transform_func: Callable[[Any], Any], input_key: str, output_key: str):
        super().__init__()
        self.transform_func = transform_func
        self.input_key = input_key
        self.output_key = output_key
    
    def prep(self, shared: SharedState) -> Any:
        return shared.get(self.input_key)
    
    def exec(self, input_data: Any) -> Any:
        return self.transform_func(input_data)
    
    def post(self, shared: SharedState, prep_res: Any, exec_res: Any) -> Optional[str]:
        shared[self.output_key] = exec_res
        return "default"

# Utility functions
def create_simple_agent(question_key: str = "question", answer_key: str = "answer") -> Flow:
    """Create a simple question-answering agent"""
    
    class QuestionAnswerNode(LLMNode):
        def prep(self, shared: SharedState) -> str:
            question = shared.get(question_key, "")
            return f"Please answer the following question clearly and concisely:\n\nQuestion: {question}\n\nAnswer:"
        
        def exec(self, prompt: str) -> str:
            return self.call_llm(prompt)
        
        def post(self, shared: SharedState, prep_res: str, exec_res: str) -> Optional[str]:
            shared[answer_key] = exec_res
            return "done"
    
    answer_node = QuestionAnswerNode()
    return Flow(start_node=answer_node)

def create_research_agent() -> Flow:
    """Create a research agent that can search and answer questions"""
    
    class DecideActionNode(DecisionNode):
        def __init__(self):
            super().__init__(
                decision_prompt="Based on the question and current context, decide whether to search for more information or provide an answer.",
                actions=["search", "answer"]
            )
    
    class SearchNode(Node):
        def prep(self, shared: SharedState) -> str:
            return shared.get("search_query", shared.get("question", ""))
        
        def exec(self, query: str) -> str:
            # Placeholder for actual search
            return f"Search results for: {query}"
        
        def post(self, shared: SharedState, prep_res: str, exec_res: str) -> Optional[str]:
            current_context = shared.get("context", "")
            shared["context"] = current_context + "\n\n" + exec_res
            return "decide"
    
    class AnswerNode(LLMCallNode):
        def __init__(self):
            super().__init__(
                prompt_template="Question: {question}\nContext: {context}\n\nProvide a comprehensive answer:",
                output_key="answer"
            )
        
        def post(self, shared: SharedState, prep_res: str, exec_res: str) -> Optional[str]:
            shared["answer"] = exec_res
            return "done"
    
    # Create nodes
    decide = DecideActionNode()
    search = SearchNode()
    answer = AnswerNode()
    
    # Connect nodes
    decide - "search" >> search
    decide - "answer" >> answer
    search - "decide" >> decide
    
    return Flow(start_node=decide)

# Export the main classes and functions
__all__ = [
    'SharedState', 'BaseNode', 'Node', 'Flow', 'LLMNode', 'LLMCallNode', 
    'DecisionNode', 'DataTransformNode', 'ConditionalTransition',
    'create_simple_agent', 'create_research_agent'
]