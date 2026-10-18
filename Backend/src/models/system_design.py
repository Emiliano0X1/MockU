from typing import Any, Dict, List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field

NodeType = Literal[
    "client",
    "load_balancer",
    "api_service",
    "cache",
    "database",
    "queue",
    "object_storage",
    "cdn",
    "worker",
]

DiagramStatus = Literal["pending", "ready", "accepted", "rejected", "failed"]


class GraphNode(BaseModel):
    id: str = Field(..., description="Unique node identifier, e.g. node_client")
    type: NodeType = Field(..., description="Restricted architectural node type")
    label: str = Field(..., description="Human readable name, e.g. 'Redis Cache'")
    description: Optional[str] = Field(None, description="Component role in architecture")


class GraphEdge(BaseModel):
    id: str = Field(..., description="Unique edge identifier, e.g. edge_1")
    source: str = Field(..., description="Source node id")
    target: str = Field(..., description="Target node id")
    label: Optional[str] = Field(None, description="Action or payload description")
    protocol: Optional[str] = Field(None, description="Communication protocol, e.g. HTTPS, gRPC")


class GraphData(BaseModel):
    schema_version: str = "1.0.0"
    prompt: Optional[str] = None
    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)


class GlassesDiagramSummary(BaseModel):
    component_count: int
    components: List[str]


class DiagramVersionResponse(BaseModel):
    session_id: UUID
    attempt_number: int = 1
    status: DiagramStatus
    graph: Optional[GraphData] = None
    glasses_summary: Optional[GlassesDiagramSummary] = None
    can_retry: bool = False
    message: Optional[str] = None


class DiagramAcceptRequest(BaseModel):
    attempt_number: Optional[int] = 1


class DiagramRejectRequest(BaseModel):
    attempt_number: Optional[int] = 1
    reason: Optional[str] = None


class SystemDesignAttemptUploadResponse(BaseModel):
    session_id: UUID
    attempt_number: int = 1
    status: Literal["interpreting"] = "interpreting"
    message: str = "Attempt audio received. Interpreting architecture diagram..."
