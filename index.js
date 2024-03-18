const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const groupsTableName = process.env.GROUPS_TABLE;
const connectionsTableName = process.env.CONNECTIONS_TABLE;

exports.handler = async (event) => {
    const { groupId, userId } = JSON.parse(event.body);
    const connectionId = event.requestContext.connectionId;

    try {
        // Retrieve the group to ensure it exists and to get current usersConnected
        const groupResponse = await dynamoDb.get({
            TableName: groupsTableName,
            Key: { groupId },
        }).promise();

        const group = groupResponse.Item;

        if (!group) {
            return { statusCode: 404, body: JSON.stringify({ message: "Group not found.", action: 'leaveChat' }) };
        }

        // Proceed only if the user is currently marked as connected
        if (!(group.usersConnected || []).includes(userId)) {
            return { statusCode: 400, body: JSON.stringify({ message: "User not currently connected to the chat.", action: 'leaveChat' }) };
        }

        // Remove the user from the usersConnected list
        const updatedUsersConnected = group.usersConnected.filter(user => user !== userId);

        // Update the group in DynamoDB
        await dynamoDb.update({
            TableName: groupsTableName,
            Key: { groupId },
            UpdateExpression: "SET usersConnected = :usersConnected",
            ExpressionAttributeValues: {
                ':usersConnected': updatedUsersConnected,
            },
        }).promise();

        // Remove the connection from the connections table
        await dynamoDb.delete({
            TableName: connectionsTableName,
            Key: { connectionId: connectionId },
        }).promise();

        return { statusCode: 200, body: JSON.stringify({ message: "User left chat successfully.", action: 'leaveChat' }) };
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: "Failed to leave chat", action: 'leaveChat' }) };
    }
};
