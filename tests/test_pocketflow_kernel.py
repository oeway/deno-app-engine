#!/usr/bin/env python3
"""
PocketFlow Kernel Integration Tests
==================================

Test script to validate PocketFlow integration within the Python kernel.
This demonstrates that the 100-line framework works correctly in Pyodide.
"""

import sys
import os
import time
import traceback

def test_imports():
    """Test that all PocketFlow components can be imported"""
    print("🧪 Testing PocketFlow imports...")
    
    try:
        # Add kernel path
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'kernel', 'py'))
        
        # Import core components
        from pocketflow_utils import (
            SharedState, BaseNode, Node, Flow, LLMNode, LLMCallNode, 
            DecisionNode, DataTransformNode, ConditionalTransition,
            create_simple_agent, create_research_agent
        )
        
        print("✅ All imports successful!")
        return True
        
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_shared_state():
    """Test SharedState functionality"""
    print("🧪 Testing SharedState...")
    
    try:
        from pocketflow_utils import SharedState
        
        # Test basic operations
        state = SharedState()
        state["key1"] = "value1"
        state.set("key2", "value2")
        
        assert state["key1"] == "value1"
        assert state.get("key2") == "value2"
        assert "key1" in state
        assert state.get("nonexistent", "default") == "default"
        
        # Test with initial data
        state2 = SharedState({"initial": "data"})
        assert state2["initial"] == "data"
        
        print("✅ SharedState tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ SharedState test failed: {e}")
        traceback.print_exc()
        return False

def test_basic_node():
    """Test basic Node functionality"""
    print("🧪 Testing basic Node functionality...")
    
    try:
        from pocketflow_utils import Node, SharedState
        
        class TestNode(Node):
            def prep(self, shared):
                return shared.get("input", "default")
            
            def exec(self, prep_res):
                return f"processed_{prep_res}"
            
            def post(self, shared, prep_res, exec_res):
                shared["output"] = exec_res
                return "completed"
        
        node = TestNode()
        state = SharedState({"input": "test_data"})
        
        result = node.run(state)
        
        assert result == "completed"
        assert state["output"] == "processed_test_data"
        
        print("✅ Basic Node tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Basic Node test failed: {e}")
        traceback.print_exc()
        return False

def test_flow_orchestration():
    """Test Flow orchestration"""
    print("🧪 Testing Flow orchestration...")
    
    try:
        from pocketflow_utils import Node, Flow, SharedState
        
        class StepNode(Node):
            def __init__(self, step_name):
                super().__init__()
                self.step_name = step_name
            
            def prep(self, shared):
                return shared.get("steps", [])
            
            def exec(self, steps):
                return steps + [self.step_name]
            
            def post(self, shared, prep_res, exec_res):
                shared["steps"] = exec_res
                return "continue" if len(exec_res) < 3 else "done"
        
        # Create a simple linear flow
        step1 = StepNode("step1")
        step2 = StepNode("step2") 
        step3 = StepNode("step3")
        
        step1 >> step2 >> step3
        
        flow = Flow(start_node=step1)
        state = SharedState()
        
        result = flow.run(state)
        
        assert "steps" in state
        assert len(state["steps"]) == 3
        assert state["steps"] == ["step1", "step2", "step3"]
        
        print("✅ Flow orchestration tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Flow orchestration test failed: {e}")
        traceback.print_exc()
        return False

def test_conditional_flow():
    """Test conditional flow branching"""
    print("🧪 Testing conditional flow branching...")
    
    try:
        from pocketflow_utils import Node, Flow, SharedState
        
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
        state_true = SharedState({"condition": True})
        result = flow.run(state_true)
        assert result == "finished"
        assert state_true["result"] == "executed_true"
        
        # Test false path
        state_false = SharedState({"condition": False})
        result = flow.run(state_false)
        assert result == "finished"
        assert state_false["result"] == "executed_false"
        
        print("✅ Conditional flow tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Conditional flow test failed: {e}")
        traceback.print_exc()
        return False

def test_data_transformation():
    """Test data transformation pipeline"""
    print("🧪 Testing data transformation pipeline...")
    
    try:
        from pocketflow_utils import DataTransformNode, Flow, SharedState
        
        def uppercase_transform(data):
            return data.upper() if isinstance(data, str) else str(data).upper()
        
        def add_prefix(data):
            return f"PREFIX_{data}"
        
        def get_length(data):
            return len(data)
        
        # Create transformation pipeline
        step1 = DataTransformNode(uppercase_transform, "input", "uppercase")
        step2 = DataTransformNode(add_prefix, "uppercase", "prefixed")
        step3 = DataTransformNode(get_length, "prefixed", "length")
        
        step1 >> step2 >> step3
        
        pipeline = Flow(start_node=step1)
        state = SharedState({"input": "hello world"})
        
        result = pipeline.run(state)
        
        assert state["uppercase"] == "HELLO WORLD"
        assert state["prefixed"] == "PREFIX_HELLO WORLD"
        assert state["length"] == len("PREFIX_HELLO WORLD")
        
        print("✅ Data transformation tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Data transformation test failed: {e}")
        traceback.print_exc()
        return False

def test_utility_functions():
    """Test utility functions"""
    print("🧪 Testing utility functions...")
    
    try:
        from pocketflow_utils import create_simple_agent, create_research_agent, SharedState
        
        # Test simple agent
        simple_agent = create_simple_agent()
        assert simple_agent is not None
        assert hasattr(simple_agent, 'start_node')
        
        # Test research agent
        research_agent = create_research_agent()
        assert research_agent is not None
        assert hasattr(research_agent, 'start_node')
        
        # Verify research agent has proper connections
        start_node = research_agent.start_node
        assert hasattr(start_node, 'successors')
        assert len(start_node.successors) > 0
        
        print("✅ Utility function tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Utility function test failed: {e}")
        traceback.print_exc()
        return False

def test_performance():
    """Test performance with larger workflows"""
    print("🧪 Testing performance...")
    
    try:
        from pocketflow_utils import Node, Flow, SharedState
        
        class CounterNode(Node):
            def prep(self, shared):
                return shared.get("count", 0)
            
            def exec(self, count):
                return count + 1
            
            def post(self, shared, prep_res, exec_res):
                shared["count"] = exec_res
                return "continue" if exec_res < 100 else "done"
        
        # Create a chain of 10 counter nodes
        nodes = [CounterNode() for _ in range(10)]
        
        # Connect them
        for i in range(len(nodes) - 1):
            nodes[i] >> nodes[i + 1]
        
        flow = Flow(start_node=nodes[0])
        state = SharedState()
        
        start_time = time.time()
        result = flow.run(state)
        end_time = time.time()
        
        execution_time = end_time - start_time
        
        assert state["count"] == 10
        assert execution_time < 1.0  # Should complete quickly
        
        print(f"✅ Performance test passed! (Execution time: {execution_time:.3f}s)")
        return True
        
    except Exception as e:
        print(f"❌ Performance test failed: {e}")
        traceback.print_exc()
        return False

def run_all_tests():
    """Run all test functions"""
    print("🚀 Starting PocketFlow Kernel Integration Tests")
    print("=" * 60)
    
    test_functions = [
        test_imports,
        test_shared_state,
        test_basic_node,
        test_flow_orchestration,
        test_conditional_flow,
        test_data_transformation,
        test_utility_functions,
        test_performance
    ]
    
    passed = 0
    failed = 0
    start_time = time.time()
    
    for test_func in test_functions:
        try:
            if test_func():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"❌ Test {test_func.__name__} crashed: {e}")
            failed += 1
        
        print()  # Add spacing between tests
    
    end_time = time.time()
    total_time = end_time - start_time
    
    print("=" * 60)
    print(f"🏁 Test Results Summary:")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"⏱️  Total time: {total_time:.2f}s")
    print(f"📊 Success rate: {(passed / (passed + failed)) * 100:.1f}%")
    
    if failed == 0:
        print("🎉 All tests passed! PocketFlow integration is working perfectly!")
    else:
        print(f"⚠️  {failed} tests failed. Please check the error messages above.")
    
    return failed == 0

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)