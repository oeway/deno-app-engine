"""
Comprehensive tests for PocketFlow integration with the Python kernel.
Demonstrates modern LLM agent patterns using the 100-line framework.
"""

import unittest
import asyncio
import sys
import os
from unittest.mock import patch, MagicMock

# Add the kernel path to import PocketFlow utilities
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'kernel', 'py'))

from pocketflow_utils import (
    SharedState, BaseNode, Node, Flow, LLMNode, LLMCallNode, 
    DecisionNode, DataTransformNode, ConditionalTransition,
    create_simple_agent, create_research_agent
)

class TestSharedState(unittest.TestCase):
    """Test the SharedState class functionality"""
    
    def setUp(self):
        self.state = SharedState()
    
    def test_initialization_empty(self):
        """Test empty initialization"""
        self.assertEqual(len(self.state.data), 0)
    
    def test_initialization_with_data(self):
        """Test initialization with data"""
        initial_data = {"key1": "value1", "key2": 42}
        state = SharedState(initial_data)
        self.assertEqual(state["key1"], "value1")
        self.assertEqual(state["key2"], 42)
    
    def test_get_set_operations(self):
        """Test get and set operations"""
        self.state.set("test_key", "test_value")
        self.assertEqual(self.state.get("test_key"), "test_value")
        self.assertIsNone(self.state.get("nonexistent_key"))
        self.assertEqual(self.state.get("nonexistent_key", "default"), "default")
    
    def test_dictionary_interface(self):
        """Test dictionary-like interface"""
        self.state["key1"] = "value1"
        self.assertEqual(self.state["key1"], "value1")
        self.assertTrue("key1" in self.state)
        self.assertFalse("key2" in self.state)
    
    def test_update_operation(self):
        """Test update operation"""
        updates = {"key1": "new_value", "key2": 100}
        self.state.update(updates)
        self.assertEqual(self.state["key1"], "new_value")
        self.assertEqual(self.state["key2"], 100)
    
    def test_to_dict(self):
        """Test conversion to dictionary"""
        self.state.update({"a": 1, "b": 2})
        result = self.state.to_dict()
        self.assertEqual(result, {"a": 1, "b": 2})
        # Ensure it's a copy
        result["c"] = 3
        self.assertNotIn("c", self.state)

class MockLLMNode(LLMNode):
    """Mock LLM node for testing"""
    
    def __init__(self, response="Mock LLM response", **kwargs):
        super().__init__(**kwargs)
        self.mock_response = response
    
    def call_llm(self, prompt: str, **kwargs) -> str:
        return f"{self.mock_response}: {prompt[:30]}..."

class TestBasicNode(unittest.TestCase):
    """Test basic node functionality"""
    
    def setUp(self):
        self.state = SharedState()
    
    def test_simple_node_execution(self):
        """Test simple node execution"""
        
        class SimpleNode(Node):
            def prep(self, shared):
                return shared.get("input", "default_input")
            
            def exec(self, prep_res):
                return f"processed_{prep_res}"
            
            def post(self, shared, prep_res, exec_res):
                shared["output"] = exec_res
                return "completed"
        
        node = SimpleNode()
        self.state["input"] = "test_data"
        
        result = node.run(self.state)
        
        self.assertEqual(result, "completed")
        self.assertEqual(self.state["output"], "processed_test_data")
    
    def test_node_retry_mechanism(self):
        """Test node retry mechanism"""
        
        class FailingNode(Node):
            def __init__(self):
                super().__init__(max_retries=3)
                self.attempt = 0
            
            def prep(self, shared):
                return None
            
            def exec(self, prep_res):
                self.attempt += 1
                if self.attempt < 3:
                    raise ValueError(f"Attempt {self.attempt} failed")
                return "success_on_third_try"
            
            def post(self, shared, prep_res, exec_res):
                shared["result"] = exec_res
                return "done"
        
        node = FailingNode()
        result = node.run(self.state)
        
        self.assertEqual(result, "done")
        self.assertEqual(self.state["result"], "success_on_third_try")
        self.assertEqual(node.attempt, 3)
    
    def test_node_connection_operators(self):
        """Test node connection operators"""
        
        class NodeA(Node):
            def prep(self, shared): return None
            def exec(self, prep_res): return "from_a"
            def post(self, shared, prep_res, exec_res): return "next"
        
        class NodeB(Node):
            def prep(self, shared): return None
            def exec(self, prep_res): return "from_b"
            def post(self, shared, prep_res, exec_res): return "done"
        
        node_a = NodeA()
        node_b = NodeB()
        
        # Test >> operator
        connected = node_a >> node_b
        self.assertEqual(connected, node_b)
        self.assertEqual(node_a.successors["default"], node_b)
        
        # Test conditional connection
        node_c = NodeB()
        conditional = node_a - "special" >> node_c
        self.assertEqual(conditional, node_c)
        self.assertEqual(node_a.successors["special"], node_c)

class TestFlow(unittest.TestCase):
    """Test Flow orchestration"""
    
    def setUp(self):
        self.state = SharedState()
    
    def test_simple_linear_flow(self):
        """Test simple linear flow execution"""
        
        class StepNode(Node):
            def __init__(self, step_name, next_action="next"):
                super().__init__()
                self.step_name = step_name
                self.next_action = next_action
            
            def prep(self, shared):
                return shared.get("data", [])
            
            def exec(self, prep_res):
                return prep_res + [self.step_name]
            
            def post(self, shared, prep_res, exec_res):
                shared["data"] = exec_res
                return self.next_action
        
        # Create a linear flow: step1 -> step2 -> step3
        step1 = StepNode("step1")
        step2 = StepNode("step2")
        step3 = StepNode("step3", "done")
        
        step1 >> step2 >> step3
        
        flow = Flow(start_node=step1)
        result = flow.run(self.state)
        
        self.assertEqual(result, "done")
        self.assertEqual(self.state["data"], ["step1", "step2", "step3"])
    
    def test_conditional_branching_flow(self):
        """Test conditional branching in flows"""
        
        class DecisionNode(Node):
            def prep(self, shared):
                return shared.get("condition", False)
            
            def exec(self, condition):
                return "true_path" if condition else "false_path"
            
            def post(self, shared, prep_res, exec_res):
                shared["decision"] = exec_res
                return exec_res
        
        class PathNode(Node):
            def __init__(self, path_name):
                super().__init__()
                self.path_name = path_name
            
            def prep(self, shared):
                return None
            
            def exec(self, prep_res):
                return f"executed_{self.path_name}"
            
            def post(self, shared, prep_res, exec_res):
                shared["result"] = exec_res
                return "finished"
        
        # Create branching flow
        decision = DecisionNode()
        true_path = PathNode("true")
        false_path = PathNode("false")
        
        decision - "true_path" >> true_path
        decision - "false_path" >> false_path
        
        flow = Flow(start_node=decision)
        
        # Test true path
        self.state["condition"] = True
        result = flow.run(self.state)
        self.assertEqual(result, "finished")
        self.assertEqual(self.state["result"], "executed_true")
        
        # Reset and test false path
        self.state = SharedState({"condition": False})
        result = flow.run(self.state)
        self.assertEqual(result, "finished")
        self.assertEqual(self.state["result"], "executed_false")

class TestLLMIntegration(unittest.TestCase):
    """Test LLM integration features"""
    
    def setUp(self):
        self.state = SharedState()
    
    def test_llm_call_node(self):
        """Test LLMCallNode functionality"""
        
        class TestLLMCallNode(LLMCallNode):
            def call_llm(self, prompt, **kwargs):
                return f"Mock response to: {prompt}"
        
        node = TestLLMCallNode(
            prompt_template="Question: {question}\nAnswer:",
            output_key="answer"
        )
        
        self.state["question"] = "What is 2+2?"
        result = node.run(self.state)
        
        self.assertEqual(result, "default")
        self.assertIn("Mock response to:", self.state["answer"])
        self.assertIn("What is 2+2?", self.state["answer"])
    
    def test_decision_node(self):
        """Test DecisionNode functionality"""
        
        class TestDecisionNode(DecisionNode):
            def call_llm(self, prompt, **kwargs):
                # Mock LLM that always chooses "search"
                return "I think we should search for more information."
        
        node = TestDecisionNode(
            decision_prompt="What should we do next?",
            actions=["search", "answer", "wait"]
        )
        
        result = node.run(self.state)
        
        self.assertEqual(result, "search")
        self.assertEqual(self.state["last_decision"], "search")

class TestAdvancedPatterns(unittest.TestCase):
    """Test advanced PocketFlow patterns"""
    
    def setUp(self):
        self.state = SharedState()
    
    def test_research_agent_pattern(self):
        """Test research agent pattern"""
        
        class MockDecisionNode(DecisionNode):
            def __init__(self):
                super().__init__(
                    decision_prompt="Decide action",
                    actions=["search", "answer"]
                )
                self.call_count = 0
            
            def call_llm(self, prompt, **kwargs):
                self.call_count += 1
                if self.call_count == 1:
                    return "search for information"
                else:
                    return "answer the question"
        
        class MockSearchNode(Node):
            def prep(self, shared):
                return shared.get("question", "")
            
            def exec(self, query):
                return f"Search results for: {query}"
            
            def post(self, shared, prep_res, exec_res):
                current_context = shared.get("context", "")
                shared["context"] = current_context + "\n" + exec_res
                return "decide"
        
        class MockAnswerNode(Node):
            def prep(self, shared):
                return shared.get("context", "")
            
            def exec(self, context):
                return f"Final answer based on: {context}"
            
            def post(self, shared, prep_res, exec_res):
                shared["answer"] = exec_res
                return "done"
        
        # Build the research agent flow
        decide = MockDecisionNode()
        search = MockSearchNode()
        answer = MockAnswerNode()
        
        decide - "search" >> search
        decide - "answer" >> answer
        search - "decide" >> decide
        
        flow = Flow(start_node=decide)
        
        # Test the research flow
        self.state["question"] = "What is machine learning?"
        result = flow.run(self.state)
        
        self.assertEqual(result, "done")
        self.assertIn("Search results for:", self.state["context"])
        self.assertIn("Final answer based on:", self.state["answer"])
        self.assertEqual(decide.call_count, 2)  # Should make decision twice
    
    def test_data_transformation_pipeline(self):
        """Test data transformation pipeline pattern"""
        
        def uppercase_transform(data):
            return data.upper() if isinstance(data, str) else str(data).upper()
        
        def add_prefix_transform(data):
            return f"PROCESSED: {data}"
        
        def word_count_transform(data):
            return len(data.split()) if isinstance(data, str) else 0
        
        # Create transformation pipeline
        step1 = DataTransformNode(uppercase_transform, "input", "uppercase")
        step2 = DataTransformNode(add_prefix_transform, "uppercase", "prefixed")
        step3 = DataTransformNode(word_count_transform, "prefixed", "word_count")
        
        step1 >> step2 >> step3
        
        flow = Flow(start_node=step1)
        
        self.state["input"] = "hello world testing"
        result = flow.run(self.state)
        
        self.assertEqual(self.state["uppercase"], "HELLO WORLD TESTING")
        self.assertEqual(self.state["prefixed"], "PROCESSED: HELLO WORLD TESTING")
        self.assertEqual(self.state["word_count"], 4)
    
    def test_multi_step_llm_workflow(self):
        """Test multi-step LLM workflow"""
        
        class PlannerNode(MockLLMNode):
            def __init__(self):
                super().__init__("Create a plan:")
            
            def prep(self, shared):
                return f"Task: {shared.get('task', '')}"
            
            def exec(self, prompt):
                return "Step 1: Research\nStep 2: Analyze\nStep 3: Conclude"
            
            def post(self, shared, prep_res, exec_res):
                shared["plan"] = exec_res
                return "execute"
        
        class ExecutorNode(MockLLMNode):
            def __init__(self):
                super().__init__("Execute plan:")
            
            def prep(self, shared):
                return f"Plan: {shared.get('plan', '')}"
            
            def exec(self, prompt):
                return "Executed all steps successfully"
            
            def post(self, shared, prep_res, exec_res):
                shared["execution_result"] = exec_res
                return "review"
        
        class ReviewerNode(MockLLMNode):
            def __init__(self):
                super().__init__("Review results:")
            
            def prep(self, shared):
                return f"Results: {shared.get('execution_result', '')}"
            
            def exec(self, prompt):
                return "Review complete: All objectives met"
            
            def post(self, shared, prep_res, exec_res):
                shared["final_review"] = exec_res
                return "complete"
        
        # Build workflow
        planner = PlannerNode()
        executor = ExecutorNode()
        reviewer = ReviewerNode()
        
        planner - "execute" >> executor
        executor - "review" >> reviewer
        
        flow = Flow(start_node=planner)
        
        self.state["task"] = "Analyze market trends"
        result = flow.run(self.state)
        
        self.assertEqual(result, "complete")
        self.assertIn("Step 1", self.state["plan"])
        self.assertIn("Executed all steps", self.state["execution_result"])
        self.assertIn("Review complete", self.state["final_review"])

class TestUtilityFunctions(unittest.TestCase):
    """Test utility functions"""
    
    def test_create_simple_agent(self):
        """Test simple agent creation utility"""
        agent = create_simple_agent()
        
        self.assertIsInstance(agent, Flow)
        self.assertIsNotNone(agent.start_node)
        
        # Test the agent
        state = SharedState({"question": "What is AI?"})
        result = agent.run(state)
        
        self.assertEqual(result, "done")
        self.assertIn("answer", state)
    
    def test_create_research_agent(self):
        """Test research agent creation utility"""
        agent = create_research_agent()
        
        self.assertIsInstance(agent, Flow)
        self.assertIsNotNone(agent.start_node)
        
        # The research agent should have the proper node connections
        start_node = agent.start_node
        self.assertTrue(hasattr(start_node, 'successors'))
        self.assertIn("search", start_node.successors)
        self.assertIn("answer", start_node.successors)

class TestIntegrationScenarios(unittest.TestCase):
    """Test real-world integration scenarios"""
    
    def test_customer_support_agent(self):
        """Test customer support agent scenario"""
        
        class ClassifyRequestNode(DecisionNode):
            def __init__(self):
                super().__init__(
                    decision_prompt="Classify the customer request",
                    actions=["technical", "billing", "general"]
                )
            
            def call_llm(self, prompt, **kwargs):
                request = self.extract_request_from_prompt(prompt)
                if "password" in request or "login" in request:
                    return "technical support needed"
                elif "payment" in request or "bill" in request:
                    return "billing department required"
                else:
                    return "general inquiry"
            
            def extract_request_from_prompt(self, prompt):
                # Simple extraction for testing
                return prompt.lower()
        
        class TechnicalSupportNode(Node):
            def prep(self, shared):
                return shared.get("request", "")
            
            def exec(self, request):
                return f"Technical solution for: {request}"
            
            def post(self, shared, prep_res, exec_res):
                shared["response"] = exec_res
                return "resolved"
        
        class BillingSupportNode(Node):
            def prep(self, shared):
                return shared.get("request", "")
            
            def exec(self, request):
                return f"Billing assistance for: {request}"
            
            def post(self, shared, prep_res, exec_res):
                shared["response"] = exec_res
                return "resolved"
        
        class GeneralSupportNode(Node):
            def prep(self, shared):
                return shared.get("request", "")
            
            def exec(self, request):
                return f"General help for: {request}"
            
            def post(self, shared, prep_res, exec_res):
                shared["response"] = exec_res
                return "resolved"
        
        # Build support agent
        classifier = ClassifyRequestNode()
        technical = TechnicalSupportNode()
        billing = BillingSupportNode()
        general = GeneralSupportNode()
        
        classifier - "technical" >> technical
        classifier - "billing" >> billing
        classifier - "general" >> general
        
        support_agent = Flow(start_node=classifier)
        
        # Test technical request
        state = SharedState({"request": "I can't login to my account"})
        result = support_agent.run(state)
        
        self.assertEqual(result, "resolved")
        self.assertIn("Technical solution", state["response"])
        
        # Test billing request
        state = SharedState({"request": "I have a question about my payment"})
        result = support_agent.run(state)
        
        self.assertEqual(result, "resolved")
        self.assertIn("Billing assistance", state["response"])
    
    def test_content_creation_pipeline(self):
        """Test content creation pipeline scenario"""
        
        class OutlineGeneratorNode(MockLLMNode):
            def prep(self, shared):
                return f"Topic: {shared.get('topic', '')}"
            
            def exec(self, prompt):
                return "1. Introduction\n2. Main Points\n3. Conclusion"
            
            def post(self, shared, prep_res, exec_res):
                shared["outline"] = exec_res
                return "draft"
        
        class DraftWriterNode(MockLLMNode):
            def prep(self, shared):
                return f"Outline: {shared.get('outline', '')}"
            
            def exec(self, prompt):
                return "Draft content based on the outline..."
            
            def post(self, shared, prep_res, exec_res):
                shared["draft"] = exec_res
                return "edit"
        
        class EditorNode(MockLLMNode):
            def prep(self, shared):
                return f"Draft: {shared.get('draft', '')}"
            
            def exec(self, prompt):
                return "Polished final content..."
            
            def post(self, shared, prep_res, exec_res):
                shared["final_content"] = exec_res
                return "published"
        
        # Build content pipeline
        outliner = OutlineGeneratorNode()
        writer = DraftWriterNode()
        editor = EditorNode()
        
        outliner - "draft" >> writer
        writer - "edit" >> editor
        
        content_pipeline = Flow(start_node=outliner)
        
        state = SharedState({"topic": "AI in Healthcare"})
        result = content_pipeline.run(state)
        
        self.assertEqual(result, "published")
        self.assertIn("Introduction", state["outline"])
        self.assertIn("Draft content", state["draft"])
        self.assertIn("Polished final", state["final_content"])

if __name__ == "__main__":
    # Run all tests
    unittest.main(verbosity=2)